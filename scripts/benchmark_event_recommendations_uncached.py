#!/usr/bin/env python3
"""Uncached Real-World Live Benchmark for Event Networking Recommendations.

Designed to BYPASS OpenAI prompt caching and measure pure cold generation latency
by executing completely distinct industry queries with varied candidate pools
and unique prompt structures.

Queries Evaluated:
1. Supply Chain, Freight, and Cold-Chain Distribution
2. Cloud Infrastructure, Kubernetes, and Microservices Architecture
3. Biotechnology, Genomics, and Clinical Pharmacology Research
4. Renewable Clean Energy, Solar Microgrids, and Battery Storage

Each query runs against 200 candidates with 1536-dimensional vectors.
"""

import math
import os
import random
import sys
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

ROOT_DIR = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT_DIR / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# Auto-load OPENAI_API_KEY from .env.docker if not set
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


BENCHMARK_SCENARIOS = [
    {
        "domain": "Freight & Logistics",
        "interests": ["Logistics", "Cold Chain"],
        "goals": "Looking to partner with enterprise freight shipping, refrigerated trucking, and warehouse distribution providers",
    },
    {
        "domain": "Cloud & DevOps Architecture",
        "interests": ["Kubernetes", "Microservices"],
        "goals": "Seeking senior infrastructure engineers and DevOps architects specialized in multi-region Kubernetes clusters and container security",
    },
    {
        "domain": "Biotech & Clinical Genomics",
        "interests": ["Genomics", "Pharmacology"],
        "goals": "Looking for biotechnology researchers and clinical trial directors developing targeted oncology therapies and molecular diagnostics",
    },
    {
        "domain": "Clean Energy & Grid Storage",
        "interests": ["Clean Energy", "Battery Storage"],
        "goals": "Looking to connect with solar project developers, commercial microgrid operators, and utility-scale energy storage providers",
    },
]


def generate_synthetic_attendees(count=200):
    """Generates 200 diverse attendees covering all benchmark domains."""
    domains = [
        ("Logistics & Freight", ["Freight Shipping", "Refrigerated Transport", "Warehouse Ops", "Distribution", "Air Cargo"]),
        ("Cloud Infrastructure", ["Kubernetes", "Container Security", "Terraform", "Site Reliability", "Microservices"]),
        ("Biotechnology", ["Genomic Sequencing", "Clinical Oncology", "Molecular Biology", "Pharmacology", "Drug Discovery"]),
        ("Clean Energy", ["Solar Power", "Battery Storage", "Microgrid Tech", "Grid Modernization", "Renewables"]),
    ]

    attendees = []
    rng = random.Random(99)

    for i in range(count):
        domain_name, skills = domains[i % len(domains)]
        selected_skills = rng.sample(skills, rng.randint(2, 4))

        raw_vec = [rng.gauss(0, 1) for _ in range(1536)]
        norm = math.sqrt(sum(x * x for x in raw_vec))
        unit_vec = [x / norm for x in raw_vec]

        attendee = MagicMock()
        attendee.attendee_id = f"uncached-att-{i:03d}"
        attendee.name = f"Professional {i:03d}"
        attendee.role = f"Senior Director of {selected_skills[0]}"
        attendee.company = f"Global {selected_skills[1]} Corp {i % 10}"
        attendee.interests = selected_skills
        attendee.notes = f"Over a decade of leadership in {domain_name}, actively seeking business development partnerships."
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


def run_uncached_benchmark():
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        print("\n[ERROR] No OPENAI_API_KEY found in environment or .env.docker.\n")
        return

    app = Flask("uncached_benchmark_app")
    app.config["TESTING"] = True

    attendees = generate_synthetic_attendees(200)
    mock_event = MagicMock()
    mock_event.attendees = attendees

    results = []

    print("\n" + "=" * 70)
    print("LIVE UNCACHED BENCHMARK (4 DISTINCT INDUSTRY DOMAINS)")
    print("=" * 70)
    print(f"Candidates Evaluated: 200 attendees (1536-dim vectors)")
    print(f"Distinct Scenarios:   {len(BENCHMARK_SCENARIOS)} queries (bypasses prompt caching)")
    print("Calling OpenAI live endpoints...\n")

    for idx, scenario in enumerate(BENCHMARK_SCENARIOS):
        query_text = f"Interests: {', '.join(scenario['interests'])} | Goals: {scenario['goals']}"
        print(f"[{idx + 1}/{len(BENCHMARK_SCENARIOS)}] Domain: {scenario['domain']}...", end="", flush=True)

        t_start = time.perf_counter()

        with app.app_context(), patch("core.ai_client._write_usage_row"):
            # 1. Query embedding (live)
            t0 = time.perf_counter()
            query_vectors = service._embed_texts([query_text])
            t1 = time.perf_counter()
            embed_ms = (t1 - t0) * 1000.0
            query_vec = query_vectors[0]

            # 2. Vector math across 200 candidates (real in-memory cosine)
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
            vec_ms = (t2 - t1) * 1000.0

            # 3. Live Top-10 Batched Reason generation (gpt-4o-mini)
            # Unique prompt context prevents cache matching
            reasons_map = service._generate_reasons_for_top_matches(
                query_text=query_text,
                top_matches=top_candidates,
            )
            t3 = time.perf_counter()
            llm_ms = (t3 - t2) * 1000.0

        total_s = (t3 - t_start)
        results.append({
            "domain": scenario["domain"],
            "embed_ms": embed_ms,
            "vec_ms": vec_ms,
            "llm_ms": llm_ms,
            "total_s": total_s,
        })

        print(f" Done! Total: {total_s:.2f}s  (Embed: {embed_ms:.0f}ms | Vector: {vec_ms:.1f}ms | LLM: {llm_ms / 1000.0:.2f}s)")

    totals = [r["total_s"] for r in results]
    avg_total = sum(totals) / len(totals)
    min_total = min(totals)
    max_total = max(totals)
    avg_embed = sum(r["embed_ms"] for r in results) / len(results)
    avg_vec = sum(r["vec_ms"] for r in results) / len(results)
    avg_llm = sum(r["llm_ms"] for r in results) / len(results)

    cost_per_run = (35 / 1_000_000) * EMBEDDING_PRICE_PER_1M + ((550 / 1_000_000) * LLM_INPUT_PRICE_PER_1M + (160 / 1_000_000) * LLM_OUTPUT_PRICE_PER_1M)
    total_cost = cost_per_run * len(BENCHMARK_SCENARIOS)

    print("\n" + "=" * 70)
    print("UNCACHED MULTI-DOMAIN BENCHMARK SUMMARY (200 ATTENDEES)")
    print("=" * 70)
    for r in results:
        print(f"• {r['domain']:<28} Total: {r['total_s']:.2f}s  (LLM: {r['llm_ms']/1000.0:.2f}s | Embed: {r['embed_ms']:.0f}ms)")
    print("-" * 70)
    print(f"• In-Memory 200-Vector Cosine Math:  {avg_vec:.2f} ms")
    print(f"• Average Query Embedding (OpenAI):  {avg_embed:.1f} ms")
    print(f"• Average Top-10 LLM Reason (OpenAI): {avg_llm / 1000.0:.2f} s")
    print(f"• Overall Average Latency:           {avg_total:.2f} s  (Min: {min_total:.2f}s, Max: {max_total:.2f}s)")
    print("-" * 70)
    print(f"• Cost per single recommendation run: ${cost_per_run:.6f} (~$0.00018)")
    print(f"• Total cost for all 4 distinct runs: ${total_cost:.6f} (< 0.08 cents)")
    print("=" * 70 + "\n")


if __name__ == "__main__":
    run_uncached_benchmark()

