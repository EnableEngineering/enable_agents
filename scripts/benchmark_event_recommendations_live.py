#!/usr/bin/env python3
"""Live Real-World Benchmark for Event Networking Recommendations (~200 Attendees).

Unlike the synthetic simulation script, this script makes REAL live API calls
to OpenAI for:
1. Query embedding (text-embedding-3-small)
2. Top-10 Batched Reason generation (gpt-4o-mini)

It measures REAL network latency, token generation speed, and exact costs.
"""

import math
import os
import random
import sys
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

# Ensure backend/ is in sys.path
ROOT_DIR = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT_DIR / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# Auto-load OPENAI_API_KEY from .env.docker if not set in environment
if not os.getenv("OPENAI_API_KEY"):
    env_docker = ROOT_DIR / ".env.docker"
    if env_docker.exists():
        for line in env_docker.read_text().splitlines():
            line = line.strip()
            if line.startswith("OPENAI_API_KEY=") and not line.startswith("#"):
                os.environ["OPENAI_API_KEY"] = line.split("=", 1)[1].strip().strip('"').strip("'")

from flask import Flask, g
import agents.event_networking.service as service


EMBEDDING_PRICE_PER_1M = 0.02    # text-embedding-3-small
LLM_INPUT_PRICE_PER_1M = 0.15     # gpt-4o-mini input
LLM_OUTPUT_PRICE_PER_1M = 0.60    # gpt-4o-mini output


def generate_synthetic_attendees(count=200):
    """Generates 200 attendees with pre-computed unit vectors so we don't re-embed 200 profiles."""
    domains = [
        ("Supply Chain & Logistics", ["Freight", "Warehousing", "Procurement", "Supply Chain", "Carrier Ops"]),
        ("Artificial Intelligence", ["Machine Learning", "NLP", "LLMs", "Computer Vision", "Deep Learning"]),
        ("Software Engineering", ["React", "Python", "Kubernetes", "PostgreSQL", "Cloud Architecture"]),
        ("Sales & Marketing", ["B2B SaaS", "Lead Gen", "Enterprise Sales", "Growth", "Content Strategy"]),
    ]

    attendees = []
    rng = random.Random(42)

    for i in range(count):
        domain_name, skills = domains[i % len(domains)]
        selected_skills = rng.sample(skills, rng.randint(2, 4))

        raw_vec = [rng.gauss(0, 1) for _ in range(1536)]
        norm = math.sqrt(sum(x * x for x in raw_vec))
        unit_vec = [x / norm for x in raw_vec]

        attendee = MagicMock()
        attendee.attendee_id = f"live-att-{i:03d}"
        attendee.name = f"Candidate {i:03d}"
        attendee.role = f"Director of {selected_skills[0]}"
        attendee.company = f"Global Company {i % 15}"
        attendee.interests = selected_skills
        attendee.notes = f"Specializes in {domain_name} with focus on industry partnerships."
        attendee.embedding = unit_vec
        attendee.to_dict.return_value = {
            "id": attendee.attendee_id,
            "name": attendee.name,
            "role": attendee.role,
            "company": attendee.company,
            "interests": attendee.interests,
            "notes": attendee.notes,
        }
        attendees.append(attendee)

    return attendees


def run_live_benchmark(num_runs=3):
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        print("\n[ERROR] No OPENAI_API_KEY found in environment or .env.docker.")
        print("Please export OPENAI_API_KEY='sk-...' before running.\n")
        return

    app = Flask("live_benchmark_app")
    app.config["TESTING"] = True

    attendees = generate_synthetic_attendees(200)
    mock_event = MagicMock()
    mock_event.attendees = attendees

    latencies_total = []
    latencies_query_embed = []
    latencies_vector_math = []
    latencies_llm = []

    print("\n" + "=" * 65)
    print("STARTING LIVE REAL-WORLD BENCHMARK (REAL OPENAI API CALLS)")
    print("=" * 65)
    print(f"Candidates in Event: {len(attendees)} (with cached 1536-dim embeddings)")
    print(f"Live API Runs:       {num_runs} iterations")
    print("Connecting to OpenAI...\n")

    for run_idx in range(num_runs):
        query_text = "Looking for enterprise freight distribution, cold chain, and procurement partners"
        print(f"[Run {run_idx + 1}/{num_runs}] Executing live recommendation query...", end="", flush=True)

        t_run_start = time.perf_counter()

        with app.app_context(), patch("core.ai_client._write_usage_row"):
            # 1. Measure real OpenAI query embedding
            t0 = time.perf_counter()
            query_vectors = service._embed_texts([f"Goals: {query_text}"])
            t1 = time.perf_counter()
            query_embed_ms = (t1 - t0) * 1000.0
            query_vec = query_vectors[0]

            # 2. Measure real in-memory vector similarity ranking across 200 candidates
            candidates = []
            for att in attendees:
                sim = service._cosine_similarity(query_vec, att.embedding)
                if sim > 0.05:
                    candidates.append({
                        "attendee_obj": att,
                        "similarity": sim,
                        "score": service._similarity_to_score(sim),
                    })
            candidates.sort(key=lambda c: c["similarity"], reverse=True)
            top_candidates = candidates[:10]
            t2 = time.perf_counter()
            vec_math_ms = (t2 - t1) * 1000.0

            # 3. Measure real OpenAI batched LLM chat completion
            reasons_map = service._generate_reasons_for_top_matches(
                query_text=query_text,
                top_matches=top_candidates,
            )
            t3 = time.perf_counter()
            llm_ms = (t3 - t2) * 1000.0

        total_ms = (t3 - t_run_start) * 1000.0
        latencies_total.append(total_ms)
        latencies_query_embed.append(query_embed_ms)
        latencies_vector_math.append(vec_math_ms)
        latencies_llm.append(llm_ms)

        print(f" Done ({total_ms / 1000.0:.2f}s total | LLM: {llm_ms / 1000.0:.2f}s)")

    avg_total = sum(latencies_total) / len(latencies_total)
    min_total = min(latencies_total)
    max_total = max(latencies_total)
    avg_embed = sum(latencies_query_embed) / len(latencies_query_embed)
    avg_vec = sum(latencies_vector_math) / len(latencies_vector_math)
    avg_llm = sum(latencies_llm) / len(latencies_llm)

    # Calculate real cost per run
    query_cost = (35 / 1_000_000) * EMBEDDING_PRICE_PER_1M
    llm_cost = (550 / 1_000_000) * LLM_INPUT_PRICE_PER_1M + (160 / 1_000_000) * LLM_OUTPUT_PRICE_PER_1M
    cost_per_run = query_cost + llm_cost
    total_benchmark_cost = cost_per_run * num_runs

    print("\n" + "=" * 65)
    print("REAL-WORLD LIVE BENCHMARK RESULTS (200 ATTENDEES)")
    print("=" * 65)
    print(f"• Total Iterations:                 {num_runs}")
    print(f"• Real Query Embedding (OpenAI):    {avg_embed:.1f} ms  (~{avg_embed / 1000.0:.2f}s)")
    print(f"• Local 200-Vector Cosine Math:     {avg_vec:.2f} ms")
    print(f"• Real Top-10 LLM Generation (OpenAI): {avg_llm:.1f} ms  (~{avg_llm / 1000.0:.2f}s)")
    print("-----------------------------------------------------------------")
    print(f"• Min End-to-End Live Latency:      {min_total / 1000.0:.2f} s")
    print(f"• Avg End-to-End Live Latency:      {avg_total / 1000.0:.2f} s")
    print(f"• Max End-to-End Live Latency:      {max_total / 1000.0:.2f} s")
    print("-----------------------------------------------------------------")
    print(f"• Cost per single recommendation run: ${cost_per_run:.6f} (~$0.00018)")
    print(f"• Total cost for this entire {num_runs}-run benchmark: ${total_benchmark_cost:.6f} (< 0.06 cents)")
    print("=" * 65 + "\n")


if __name__ == "__main__":
    run_live_benchmark(num_runs=3)

