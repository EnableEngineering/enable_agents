from types import SimpleNamespace

from agents.content_marketing import rag_content_generator


class FakeLLM:
    def __init__(self):
        self.prompts = []

    def invoke(self, prompt):
        self.prompts.append(prompt)
        return SimpleNamespace(content=f"Generated version {len(self.prompts)}")


def test_generation_uses_semantically_retrieved_document_context(monkeypatch):
    llm = FakeLLM()
    embedding_inputs = []

    def fake_embeddings(user_id, project_id, agent, model, input):
        embedding_inputs.append(input)
        if len(input) == 1:
            vectors = [[1.0, 0.0]]
        else:
            vectors = [
                [1.0, 0.0] if "CNC" in text else [0.0, 1.0]
                for text in input
            ]
        return SimpleNamespace(
            data=[SimpleNamespace(embedding=vector) for vector in vectors]
        )

    monkeypatch.setattr("core.ai_client.ai_embeddings", fake_embeddings)
    monkeypatch.setattr(
        rag_content_generator,
        "get_langchain_llm",
        lambda *args, **kwargs: (llm, "platform", "gpt-4"),
    )
    monkeypatch.setattr(rag_content_generator, "log_langchain_usage", lambda *args: None)

    result = rag_content_generator.RAGContentGenerator("user-1", "project-1").generate(
        documents=[
            "CNC machining capacity supports automotive suppliers.",
            "Free shipping is available for sustainable retail packaging.",
        ],
        knowledge_graph={"entities": ["CNC machining"], "relationships": []},
        channel="linkedin",
        content_type="post",
        user_context="Announce our CNC expansion.",
    )

    assert "CNC machining capacity" in llm.prompts[0]
    assert llm.prompts[0].index("CNC machining capacity") < llm.prompts[0].index("Free shipping")
    assert result["metadata"]["sources_used"] == 2
    assert result["content"] == "Generated version 1"
    assert len(result["variations"]) == 2
    assert len(embedding_inputs) == 2