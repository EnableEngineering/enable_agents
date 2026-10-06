"""Document-grounded content generation for the Content Marketing agent."""

import json
from typing import Any, Dict, List, Optional

import faiss
import numpy as np

from core.ai_client import ai_embeddings, get_langchain_llm, log_langchain_usage


class RAGContentGenerator:
    """Generate and refine marketing content using retrieved document context."""

    CHANNEL_CONFIGS = {
        "linkedin": {"tone": "professional", "max_length": 3000},
        "email": {"tone": "persuasive", "max_length": 500},
        "social": {"tone": "casual", "max_length": 280},
        "google_ads": {"tone": "direct", "max_length": 150},
    }
    CONTENT_TYPES = {
        "post": "social media post",
        "article": "long-form article",
        "ad": "advertising copy",
        "email_campaign": "email marketing campaign",
        "case_study": "case study",
        "whitepaper": "technical whitepaper",
        "announcement": "product or company announcement",
    }

    def __init__(self, user_id: str, project_id: Optional[str] = None):
        self.user_id = user_id
        self.project_id = project_id
        self._llm = None
        self._key_source = None
        self._model = None

    def _get_llm(self):
        if self._llm is None:
            self._llm, self._key_source, self._model = get_langchain_llm(
                self.user_id, self.project_id, model="gpt-4", temperature=0.7
            )
        return self._llm

    @staticmethod
    def _split_documents(documents: List[str]) -> List[Dict[str, Any]]:
        chunks = []
        for document_index, text in enumerate(documents):
            text = (text or "").strip()
            start = 0
            while start < len(text):
                end = min(start + 1200, len(text))
                if end < len(text):
                    boundary = text.rfind(" ", start + 800, end)
                    if boundary > start:
                        end = boundary
                chunk = text[start:end].strip()
                if chunk:
                    chunks.append({"content": chunk, "document_index": document_index})
                if end >= len(text):
                    break
                start = max(end - 160, start + 1)
        return chunks

    def _setup_rag(self, documents: List[str]) -> None:
        self._chunks = self._split_documents(documents)
        self._index = None
        if not self._chunks:
            return

        batch_size = 500
        all_embeddings = []
        for batch_start in range(0, len(self._chunks), batch_size):
            batch_end = min(batch_start + batch_size, len(self._chunks))
            batch_chunks = self._chunks[batch_start:batch_end]
            response = ai_embeddings(
                user_id=self.user_id,
                project_id=self.project_id,
                agent="content_marketing.rag_embeddings",
                model="text-embedding-ada-002",
                input=[chunk["content"] for chunk in batch_chunks],
            )
            all_embeddings.extend([item.embedding for item in response.data])

        vectors = np.asarray(all_embeddings, dtype="float32")
        if vectors.ndim != 2 or len(vectors) != len(self._chunks):
            raise ValueError("Embedding response did not match the source document chunks")
        faiss.normalize_L2(vectors)
        self._index = faiss.IndexFlatIP(vectors.shape[1])
        self._index.add(vectors)

    def _retrieve_context(self, query: str, limit: int = 5) -> List[Dict[str, Any]]:
        if self._index is None:
            return []
        response = ai_embeddings(
            user_id=self.user_id,
            project_id=self.project_id,
            agent="content_marketing.rag_query",
            model="text-embedding-ada-002",
            input=[query],
        )
        query_vector = np.asarray([response.data[0].embedding], dtype="float32")
        faiss.normalize_L2(query_vector)
        _, indexes = self._index.search(query_vector, min(limit, len(self._chunks)))
        return [self._chunks[index] for index in indexes[0] if index >= 0]

    @staticmethod
    def _graph_context(knowledge_graph: Optional[Dict[str, Any]]) -> str:
        if not knowledge_graph:
            return "No knowledge graph available."

        parts = []
        for key in ("entities", "concepts"):
            values = knowledge_graph.get(key) or []
            names = [
                str(value.get("entity") or value.get("concept") or value.get("name") or "")
                if isinstance(value, dict)
                else str(value)
                for value in values[:8]
            ]
            names = [name for name in names if name]
            if names:
                parts.append(f"{key.title()}: {', '.join(names)}")
        relationships = knowledge_graph.get("relationships") or []
        if relationships:
            parts.append(f"Relationships: {json.dumps(relationships[:8], default=str)}")
        domain_context = knowledge_graph.get("domain_context")
        if domain_context:
            parts.append(f"Domain context: {json.dumps(domain_context, default=str)}")
        return "\n".join(parts) or "No knowledge graph details available."

    def _invoke(self, prompt: str, usage_agent: str) -> str:
        response = self._get_llm().invoke(prompt)
        log_langchain_usage(
            response, self.user_id, self.project_id, usage_agent, self._model, self._key_source
        )
        content = response.content
        if isinstance(content, list):
            content = "\n".join(
                item.get("text", "") for item in content if isinstance(item, dict)
            )
        return str(content or "")

    def generate(
        self,
        documents: List[str],
        knowledge_graph: Optional[Dict[str, Any]],
        channel: str = "linkedin",
        content_type: str = "post",
        domain_context: Optional[str] = None,
        user_context: str = "",
        language_instruction: str = "",
    ) -> Dict[str, Any]:
        config = self.CHANNEL_CONFIGS.get(channel, self.CHANNEL_CONFIGS["linkedin"])
        description = self.CONTENT_TYPES.get(content_type, "marketing content")
        self._setup_rag(documents)
        query = " ".join(
            part for part in (channel, content_type, user_context, domain_context) if part
        ) or f"Create {description} for {channel}"
        retrieved = self._retrieve_context(query)
        context = "\n\n---\n\n".join(chunk["content"] for chunk in retrieved)[:8000]
        graph_context = self._graph_context(knowledge_graph)
        prompt = f"""You are an expert marketing copywriter. Create a {description} for {channel}.
Industry: {domain_context or 'General'}
Tone: {config['tone']}
Maximum length: {config['max_length']} characters
User guidance: {user_context or 'Create engaging, fact-grounded marketing content.'}
Language instruction: {language_instruction or 'Use clear, professional language.'}

Retrieved source context:
{context or 'No relevant source passages were found.'}

Knowledge graph context:
{graph_context}

Use only factual claims supported by the source context or user guidance. Do not
invent statistics, customer names, certifications, or product capabilities.
Optimize for the conventions of {channel} and output only the finished content."""
        content = self._invoke(prompt, "content_marketing.rag_generate")
        variations = self._generate_variations(content, channel, content_type, context)
        source_indexes = sorted({chunk["document_index"] for chunk in retrieved})
        return {
            "content": content,
            "variations": variations,
            "metadata": {
                "channel": channel,
                "content_type": content_type,
                "domain": domain_context,
                "sources_used": len(source_indexes),
            },
        }

    def _generate_variations(
        self, base_content: str, channel: str, content_type: str, source_context: str
    ) -> List[str]:
        config = self.CHANNEL_CONFIGS.get(channel, self.CHANNEL_CONFIGS["linkedin"])
        variations = []
        for direction in (
            "Emphasize the customer benefits more strongly.",
            "Use a distinct opening and a more conversational style.",
        ):
            prompt = f"""Create one alternative {content_type} for {channel} based on this draft:
{base_content}

Source context:
{source_context or 'No source passages available.'}

{direction} Keep factual claims grounded in the source context, preserve the
channel tone ({config['tone']}), stay under {config['max_length']} characters,
and output only the alternative."""
            variations.append(self._invoke(prompt, "content_marketing.rag_variation"))
        return variations

    def chat_response(
        self,
        user_message: str,
        documents: List[str],
        knowledge_graph: Optional[Dict[str, Any]],
        language_instruction: str = "",
    ) -> str:
        self._setup_rag(documents)
        retrieved = self._retrieve_context(user_message, limit=3)
        context = "\n\n---\n\n".join(chunk["content"] for chunk in retrieved)[:6000]
        prompt = f"""You are a helpful marketing content assistant. Answer the user's question
using the source passages when relevant. Separate sourced facts from suggestions
and do not invent company facts.

Source context:
{context or 'No relevant source passages were found.'}

Knowledge graph context:
{self._graph_context(knowledge_graph)}

Language instruction: {language_instruction or 'Use clear, professional language.'}
User message: {user_message}"""
        return self._invoke(prompt, "content_marketing.rag_chat")