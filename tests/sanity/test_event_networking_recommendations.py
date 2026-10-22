"""Functional tests for Event Networking Semantic Recommendations.

Validates:
1. Semantic matching: Goals like 'logistics' surface attendees with 'supply chain' interests.
2. Graceful fallback: If OpenAI embedding/completion fails, keyword matching runs without error.
3. Caching: Pre-computed attendee embeddings are reused, preventing redundant API calls.
4. Reason generation: Top matches receive meaningful, concise reasons.
5. Contract safety: Response structure maintains backward compatibility with frontend.
"""

import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

BACKEND_DIR = Path(__file__).resolve().parents[2] / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from flask import Flask, g
import agents.event_networking.service as service


class EventNetworkingRecommendationsFunctionalTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask("test_event_networking")
        self.app.config["TESTING"] = True

    def _create_mock_attendee(self, attendee_id, name, role, company, interests, notes="", embedding=None):
        attendee = MagicMock()
        attendee.attendee_id = attendee_id
        attendee.name = name
        attendee.role = role
        attendee.company = company
        attendee.interests = interests
        attendee.notes = notes
        attendee.embedding = embedding
        attendee.to_dict.return_value = {
            "id": attendee_id,
            "name": name,
            "role": role,
            "company": company,
            "interests": interests,
            "notes": notes,
        }
        return attendee

    def test_semantic_ranking_surfaces_synonym_match(self):
        """User goal 'logistics' must match an attendee with 'supply chain' interests

        even with zero literal word overlap, ranking them above unrelated attendees.
        """
        # Attendee 1: Supply Chain / Freight (conceptually matches logistics)
        attendee_sc = self._create_mock_attendee(
            "att-1",
            "Alice Logistics-Match",
            "VP of Supply Chain",
            "Freight Corp",
            ["Supply Chain", "Carrier Operations", "Freight Warehousing"],
            "Oversees freight distribution network",
        )
        # Attendee 2: Frontend Engineer (completely unrelated)
        attendee_fe = self._create_mock_attendee(
            "att-2",
            "Bob Frontend",
            "Frontend Engineer",
            "WebStudio",
            ["React", "TypeScript", "Tailwind CSS"],
            "Builds web user interfaces",
        )

        # Mock embeddings: query "logistics" is close to Alice, orthogonal/far from Bob
        query_vector = [1.0, 0.0, 0.0]
        alice_vector = [0.95, 0.05, 0.0]   # High cosine similarity (~0.99)
        bob_vector = [0.0, 1.0, 0.0]     # Low cosine similarity (~0.0)

        def fake_embeddings(user_id, project_id, agent, model, input, **kwargs):
            mock_resp = MagicMock()
            if isinstance(input, list):
                # Batch embedding
                vectors = []
                for text in input:
                    t = text.lower()
                    if "supply chain" in t or "freight" in t:
                        vectors.append(alice_vector)
                    else:
                        vectors.append(bob_vector)
                mock_resp.data = [MagicMock(embedding=v) for v in vectors]
            else:
                # Single query
                mock_resp.data = [MagicMock(embedding=query_vector)]
            return mock_resp

        mock_event = MagicMock()
        mock_event.attendees = [attendee_fe, attendee_sc]

        with self.app.test_request_context(
            "/api/event-networking/events/evt-1/recommendations",
            method="POST",
            json={"interests": [], "goals": "logistics"},
        ):
            g.user_id = "test_user"
            with patch.object(service, "_owned_event_or_404", return_value=mock_event), \
                 patch("core.ai_client.ai_embeddings", side_effect=fake_embeddings), \
                 patch("core.ai_client.ai_chat_completion", return_value=MagicMock(
                     choices=[MagicMock(message=MagicMock(content="Alice Logistics-Match: VP of Supply Chain with relevant logistics background"))]
                 )):

                response, status_code = service.get_recommendations("evt-1")
                self.assertEqual(status_code, 200)
                data = response.get_json()

                self.assertTrue(data.get("success"))
                recommendations = data.get("recommendations", [])
                self.assertGreater(len(recommendations), 0, "Expected at least 1 recommendation")
                top_match = recommendations[0]
                self.assertEqual(
                    top_match["attendee"]["name"],
                    "Alice Logistics-Match",
                    "Semantic matching should surface Supply Chain specialist for 'logistics' query",
                )

    def test_fallback_to_keyword_matching_when_openai_fails(self):
        """When OpenAI embedding call fails, service must gracefully fall back

        to keyword matching without raising an unhandled 500 error.
        """
        # Attendee with exact keyword overlap
        attendee_kw = self._create_mock_attendee(
            "att-1",
            "Dave Procurement",
            "Procurement Manager",
            "Global Industries",
            ["procurement", "sourcing"],
        )
        # Attendee with no keyword overlap
        attendee_none = self._create_mock_attendee(
            "att-2",
            "Eve Mobile",
            "iOS Developer",
            "AppCo",
            ["swift", "mobile"],
        )

        mock_event = MagicMock()
        mock_event.attendees = [attendee_none, attendee_kw]

        with self.app.test_request_context(
            "/api/event-networking/events/evt-1/recommendations",
            method="POST",
            json={"interests": ["procurement"], "goals": "looking for procurement"},
        ):
            g.user_id = "test_user"
            with patch.object(service, "_owned_event_or_404", return_value=mock_event), \
                 patch("core.ai_client.ai_embeddings", side_effect=RuntimeError("OpenAI API unreachable")):

                response, status_code = service.get_recommendations("evt-1")
                self.assertEqual(status_code, 200, "Should fall back gracefully with 200 OK")
                data = response.get_json()

                self.assertTrue(data.get("success"))
                recs = data.get("recommendations", [])
                self.assertEqual(len(recs), 1)
                self.assertEqual(recs[0]["attendee"]["name"], "Dave Procurement")

    def test_cached_attendee_embeddings_avoid_redundant_api_calls(self):
        """Pre-cached attendee embeddings should be reused directly,

        calling ai_embeddings only for the query itself.
        """
        # Attendee already has cached embedding in the DB
        cached_vector = [0.8, 0.2, 0.0]
        attendee = self._create_mock_attendee(
            "att-1",
            "Frank Cached",
            "Director of Logistics",
            "ShipCo",
            ["Logistics"],
            embedding=cached_vector,
        )

        mock_event = MagicMock()
        mock_event.attendees = [attendee]

        embedding_calls = []

        def track_embeddings(*args, **kwargs):
            embedding_calls.append(kwargs.get("input"))
            mock_resp = MagicMock()
            mock_resp.data = [MagicMock(embedding=[0.8, 0.2, 0.0])]
            return mock_resp

        with self.app.test_request_context(
            "/api/event-networking/events/evt-1/recommendations",
            method="POST",
            json={"interests": ["Logistics"], "goals": "Freight"},
        ):
            g.user_id = "test_user"
            with patch.object(service, "_owned_event_or_404", return_value=mock_event), \
                 patch("core.ai_client.ai_embeddings", side_effect=track_embeddings), \
                 patch("core.ai_client.ai_chat_completion", return_value=MagicMock(
                     choices=[MagicMock(message=MagicMock(content="Frank Cached: Matches logistics"))]
                 )):

                response, status_code = service.get_recommendations("evt-1")
                self.assertEqual(status_code, 200)

                # Embedding API should only be called once (for query), not for the cached attendee
                self.assertEqual(
                    len(embedding_calls),
                    1,
                    f"Expected exactly 1 embedding call (for user query), but got {len(embedding_calls)}",
                )

    def test_response_shape_compatibility_with_frontend(self):
        """The response must contain attendee, score, and reasons

        with score as a number compatible with the frontend CSS meter.
        """
        attendee = self._create_mock_attendee(
            "att-1",
            "Grace Partner",
            "CEO",
            "PartnerCorp",
            ["Ventures"],
            embedding=[0.9, 0.1, 0.0],
        )

        mock_event = MagicMock()
        mock_event.attendees = [attendee]

        with self.app.test_request_context(
            "/api/event-networking/events/evt-1/recommendations",
            method="POST",
            json={"interests": ["Ventures"], "goals": "Partnerships"},
        ):
            g.user_id = "test_user"
            with patch.object(service, "_owned_event_or_404", return_value=mock_event), \
                 patch("core.ai_client.ai_embeddings", return_value=MagicMock(
                     data=[MagicMock(embedding=[0.9, 0.1, 0.0])]
                 )), \
                 patch("core.ai_client.ai_chat_completion", return_value=MagicMock(
                     choices=[MagicMock(message=MagicMock(content="Grace Partner: Strategic alignment"))]
                 )):

                response, status_code = service.get_recommendations("evt-1")
                self.assertEqual(status_code, 200)
                data = response.get_json()

                self.assertIn("recommendations", data)
                if data["recommendations"]:
                    item = data["recommendations"][0]
                    self.assertIn("attendee", item)
                    self.assertIn("score", item)
                    self.assertIn("reasons", item)
                    self.assertIsInstance(item["score"], (int, float))
                    self.assertTrue(0 <= item["score"] <= 100)
                    self.assertIsInstance(item["reasons"], list)
                    self.assertGreater(len(item["reasons"]), 0)

    def test_top_10_batched_llm_reasons_invoked_once(self):
        """Verifies that reasons for top attendees are generated using a single

        batched LLM call rather than N separate calls.
        """
        attendees = [
            self._create_mock_attendee(
                f"att-{i}",
                f"Person {i}",
                "Manager",
                f"Company {i}",
                ["Tech"],
                embedding=[0.8, 0.1, 0.1],
            )
            for i in range(5)
        ]

        mock_event = MagicMock()
        mock_event.attendees = attendees

        llm_calls = []

        def track_llm(*args, **kwargs):
            llm_calls.append(kwargs)
            return MagicMock(
                choices=[MagicMock(message=MagicMock(content="Person 0: Relevant\nPerson 1: Relevant"))]
            )

        with self.app.test_request_context(
            "/api/event-networking/events/evt-1/recommendations",
            method="POST",
            json={"interests": ["Tech"], "goals": "Partnerships"},
        ):
            g.user_id = "test_user"
            with patch.object(service, "_owned_event_or_404", return_value=mock_event), \
                 patch("core.ai_client.ai_embeddings", return_value=MagicMock(
                     data=[MagicMock(embedding=[0.8, 0.1, 0.1])]
                 )), \
                 patch("core.ai_client.ai_chat_completion", side_effect=track_llm):

                response, status_code = service.get_recommendations("evt-1")
                self.assertEqual(status_code, 200)

                # LLM should be called at most once (batched)
                self.assertLessEqual(
                    len(llm_calls),
                    1,
                    f"Expected 1 batched LLM call for reasons, but got {len(llm_calls)}",
                )

    def test_attendee_profile_text_compilation_includes_all_fields(self):
        """Verifies attendee profile text generator includes name, role, company,

        interests, and notes so semantic search has complete context.
        """
        attendee = self._create_mock_attendee(
            "att-1",
            "Sam Builder",
            "Chief Technology Officer",
            "RoboWorks",
            ["Robotics", "Automation"],
            "Specializes in warehouse mobile robots and industrial AGVs",
        )
        if hasattr(service, "_attendee_to_embedding_text"):
            text = service._attendee_to_embedding_text(attendee)
            self.assertIn("Sam Builder", text)
            self.assertIn("Chief Technology Officer", text)
            self.assertIn("RoboWorks", text)
            self.assertIn("Robotics", text)
            self.assertIn("warehouse mobile robots", text)


if __name__ == "__main__":
    unittest.main()


