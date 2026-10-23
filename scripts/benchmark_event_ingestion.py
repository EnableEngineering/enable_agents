#!/usr/bin/env python3
"""Benchmark for Event Networking Attendee Ingestion (200 Profiles Embedding).

This script measures the real-world latency and cost of embedding 200 attendee profiles
at ingestion time (e.g. CSV upload or lazy backfill).

It executes REAL live API calls to OpenAI using:
- Model: text-embedding-3-small (1536 dimensions)
- Batch size: 100 profiles per request (2 batches total for 200 attendees)
- Real serialization via `_attendee_to_embedding_text()`
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

from flask import Flask
import agents.event_networking.service as service
import core.ai_client as ai_client_module

EMBEDDING_PRICE_PER_1M = 0.02  # $0.02 per 1M tokens for text-embedding-3-small


def generate_realistic_profiles(count=200):
    """Generates 200 realistic attendee objects representing diverse industries."""
    domains = [
        ("Supply Chain & Logistics", [
            ("VP of Supply Chain", "Global Freight Systems", ["Freight", "Cold Chain", "Procurement", "3PL"]),
            ("Logistics Director", "Apex Cargo Worldwide", ["Warehousing", "Fleet Ops", "Route Optimization"]),
            ("Sourcing Specialist", "Continental Logistics", ["Supplier Relations", "Inventory Control", "Procurement"]),
        ]),
        ("Cloud Architecture & DevOps", [
            ("Lead Cloud Architect", "Scalable Infrastructure Inc", ["Kubernetes", "AWS", "Terraform", "DevOps"]),
            ("Site Reliability Engineer", "Reliability Engineering Co", ["Monitoring", "CI/CD", "Prometheus", "Linux"]),
            ("Platform Engineer", "Enterprise Cloud Labs", ["Docker", "Distributed Systems", "Microservices"]),
        ]),
        ("Biotechnology & Genomics", [
            ("Clinical Bioinformatician", "Helix Omics Innovations", ["Genomic Sequencing", "CRISPR", "NextGen Sequencing"]),
            ("Director of Oncology Research", "OncoDiagnostics Labs", ["Precision Oncology", "Clinical Trials", "Biomarkers"]),
            ("Computational Biologist", "GeneTech Research", ["Protein Folding", "Python", "RNA-Seq"]),
        ]),
        ("Clean Energy & Storage", [
            ("Grid Storage Specialist", "Voltaic Storage Solutions", ["Flow Batteries", "BESS", "Microgrids"]),
            ("Solar Infrastructure VP", "SunPower Utilities", ["PV Systems", "Interconnection", "Power Electronics"]),
            ("Clean Energy Policy Advisor", "Decarbonization Group", ["Carbon Offsets", "ESG", "Renewable Energy Credits"]),
        ]),
        ("FinTech & Payments", [
            ("Head of Payment Risk", "Starlight Pay", ["Fraud Detection", "AML", "PCI-DSS", "Real-Time Payments"]),
            ("Treasury Ops Manager", "Global Ledger Group", ["FX Settlement", "SWIFT", "Liquidity Management"]),
            ("Blockchain Protocol Dev", "Decentralized Finance Lab", ["Smart Contracts", "Solidity", "Zero Knowledge"]),
        ]),
    ]

    attendees = []
    rng = random.Random(42)

    for i in range(count):
        domain_name, roles = domains[i % len(domains)]
        role_template, company_template, sample_interests = roles[i % len(roles)]

        attendee = MagicMock()
        attendee.attendee_id = f"att-ingest-{i+1:03d}"
        attendee.name = f"Attendee {i+1:03d}"
        attendee.role = role_template
        attendee.company = f"{company_template} {i // len(domains) + 1}"
        attendee.interests = sample_interests
        attendee.notes = (
            f"Senior professional in {domain_name}. Seeking strategic cross-industry partnerships, "
            f"vendor collaborations, and technology exchange."
        )
        attendees.append(attendee)

    return attendees


def run_ingestion_benchmark(count=200):
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        print("ERROR: OPENAI_API_KEY not found in environment or .env.docker")
        return

    app = Flask("ingestion_benchmark_app")
    app.config["TESTING"] = True

    print("\n" + "=" * 68)
    print("STARTING ATTENDEE INGESTION BENCHMARK (REAL OPENAI EMBEDDING CALLS)")
    print("=" * 68)
    print(f"Profiles to Embed:   {count} attendees")
    print(f"Model:               text-embedding-3-small (1536-dim)")
    print(f"Batch Size:          100 profiles per API call")
    print(f"Total API Calls:     {(count + 99) // 100} batches")
    print("Connecting to OpenAI...\n")

    attendees = generate_realistic_profiles(count)
    texts = [service._attendee_to_embedding_text(a) for a in attendees]

    # Intercept batch calls to capture timings and usage
    original_ai_embeddings = ai_client_module.ai_embeddings
    batch_records = []

    def timed_ai_embeddings(*args, **kwargs):
        t0 = time.perf_counter()
        resp = original_ai_embeddings(*args, **kwargs)
        t1 = time.perf_counter()
        duration_ms = (t1 - t0) * 1000.0
        tokens = getattr(resp.usage, "total_tokens", 0) if hasattr(resp, "usage") else 0
        batch_records.append({
            "count": len(kwargs.get("input", [])),
            "duration_ms": duration_ms,
            "tokens": tokens,
        })
        return resp

    t_total_start = time.perf_counter()

    with app.app_context(), \
         patch("core.ai_client._write_usage_row"), \
         patch("core.ai_client.ai_embeddings", side_effect=timed_ai_embeddings):
        vectors = service._embed_texts(texts)

    t_total_end = time.perf_counter()
    total_wall_clock_s = t_total_end - t_total_start

    total_tokens = sum(r["tokens"] for r in batch_records)
    total_cost = (total_tokens / 1_000_000.0) * EMBEDDING_PRICE_PER_1M

    print("=" * 68)
    print("INGESTION BENCHMARK RESULTS")
    print("=" * 68)
    for idx, rec in enumerate(batch_records, 1):
        print(f"• Batch {idx} ({rec['count']} profiles): {rec['duration_ms']:.1f} ms  ({rec['tokens']:,} tokens)")
    print("-" * 68)
    print(f"• Total Profiles Embedded:   {len(vectors)} (each 1536 dimensions)")
    print(f"• Total Wall-Clock Latency:  {total_wall_clock_s:.2f} s  ({total_wall_clock_s * 1000:.1f} ms)")
    print(f"• Avg Latency Per Batch:     {total_wall_clock_s / len(batch_records):.2f} s")
    print(f"• Avg Latency Per Attendee:  {(total_wall_clock_s * 1000.0) / count:.2f} ms")
    print("-" * 68)
    print(f"• Total Tokens Consumed:     {total_tokens:,} tokens (~{total_tokens // count} tokens/profile)")
    print(f"• Total Ingestion Cost:      ${total_cost:.6f}  (~{total_cost * 100:.3f} cents)")
    if total_cost > 0:
        runs_per_dollar = int(1.0 / total_cost)
        print(f"• 200-Attendee Ingests / $1: ~{runs_per_dollar:,} ingest events")
    print("=" * 68 + "\n")


if __name__ == "__main__":
    run_ingestion_benchmark(count=200)

