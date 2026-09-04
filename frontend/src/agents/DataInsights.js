import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import Header from '../core/Header';
import { BackButton, Textarea, Select, ProjectSelector, LiveModeHint, AgentOutcomesStrip, ProjectGate, EmptyState, WorkflowExecutionBanner, WorkflowContextCard } from '../components';
import '../styles/DataInsights.css';
import { PDFDocument } from 'pdf-lib';
import { API_CONFIG } from '../config/apiConfig';
import { showToast } from '../core/toast';
import { useSelectedProjectId } from '../hooks/useSelectedProjectId';
import { useWorkflowContext } from '../hooks';
import { authJsonHeaders, authOptionalHeaders } from '../core/authHeaders';
import { STRINGS } from '../constants/strings';

// Document Intelligence API
const DOC_API = `${API_CONFIG.API_URL}/api/document-intelligence`;

// Allowed file types (must match backend)
const ALLOWED_EXTENSIONS = ['pdf', 'docx', 'doc', 'txt', 'xlsx', 'xls', 'csv'];

// Storage key for state persistence
const STATE_KEY = 'dataInsightsState';

// Suggested prompts
const SUGGESTED_PROMPTS = [
  'What are the key findings?',
  'Summarize the main metrics',
  'What are the recommendations?',
  'Identify potential risks',
  'Compare to previous period',
];

function DataInsights() {
  const navigate = useNavigate();
  const selectedProjectId = useSelectedProjectId();
  const [searchParams, setSearchParams] = useSearchParams();

  // Load persisted state
  const loadPersistedState = useCallback(() => {
    try {
      const saved = sessionStorage.getItem(STATE_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  }, []);

  // Workflow context - for saving results back to workflow
  const { isInWorkflow, isHistoryView, stageData, stageId, saveStageData, getContext } = useWorkflowContext();

  // Main view tabs
  const [activeView, setActiveView] = useState(() => {
    return searchParams.get('view') || loadPersistedState().activeView || 'library';
  });

  // Documents
  const [documents, setDocuments] = useState([]);
  const [selectedDocument, setSelectedDocument] = useState(null);

  // Upload state
  const [files, setFiles] = useState([]);
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // Query state
  const [inputPrompt, setInputPrompt] = useState('');

  // Results
  const [currentInsight, setCurrentInsight] = useState(null);
  const [isLoadingInsight, setIsLoadingInsight] = useState(false);
  const [conversationHistory, setConversationHistory] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  // Analysis view sub-tab
  const [analysisTab, setAnalysisTab] = useState('insights');

  // Persist state
  useEffect(() => {
    const state = {
      activeView,
      selectedDocId: selectedDocument?.id || null,
    };
    sessionStorage.setItem(STATE_KEY, JSON.stringify(state));

    // Update URL
    const params = new URLSearchParams(searchParams);
    if (activeView !== 'library') {
      params.set('view', activeView);
    } else {
      params.delete('view');
    }
    if (selectedDocument?.id) {
      params.set('doc', selectedDocument.id);
    } else {
      params.delete('doc');
    }
    setSearchParams(params, { replace: true });
  }, [activeView, selectedDocument, searchParams, setSearchParams]);

  // Load documents when project selected
  useEffect(() => {
    if (!selectedProjectId) {
      setDocuments([]);
      setSelectedDocument(null);
      setCurrentInsight(null);
      return;
    }

    fetchDocuments();
  }, [selectedProjectId]);

  // Fetch documents from backend (live mode)
  const fetchDocuments = async () => {
    if (!selectedProjectId) return;

    try {
      const res = await fetch(`${DOC_API}/documents?project_id=${selectedProjectId}`, {
        headers: authOptionalHeaders(),
      });

      if (res.ok) {
        const data = await res.json();
        const docs = (data.documents || []).map(doc => ({
          id: doc.document_id,
          name: doc.file_name,
          type: doc.file_type,
          size: formatFileSize(doc.file_size),
          uploadedAt: doc.created_at?.split('T')[0] || 'Unknown',
          category: doc.document_type || 'other',
          pages: doc.page_count,
          status: doc.status,
          entities: doc.entity_count || 0,
          relationships: 0, // Not tracked separately in backend
          confidence: doc.confidence != null ? doc.confidence : 0.85,
          processingProgress: doc.processing_progress,
          processingStage: doc.processing_stage,
        }));
        setDocuments(docs);
      }
    } catch (err) {
      console.error('Failed to fetch documents:', err);
      showToast('Failed to load documents', 'error');
    }
  };

  // Helper to format file size
  const formatFileSize = (bytes) => {
    if (!bytes) return 'Unknown';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Poll for document processing status
  const pollDocumentStatus = async (documentId) => {
    let attempts = 0;
    const maxAttempts = 60; // 5 minutes max

    const poll = async () => {
      try {
        const res = await fetch(`${DOC_API}/status/${documentId}?project_id=${selectedProjectId}`, {
          headers: authOptionalHeaders(),
        });

        if (res.ok) {
          const status = await res.json();

          // Update document in list
          setDocuments(prev => prev.map(d =>
            d.id === documentId
              ? {
                  ...d,
                  status: status.status,
                  entities: status.entity_count || 0,
                  confidence: status.confidence != null ? status.confidence : d.confidence,
                  processingProgress: status.processing_progress,
                  processingStage: status.processing_stage,
                }
              : d
          ));

          if (status.status === 'completed') {
            showToast(`Document processed: ${status.chunk_count} chunks, ${status.entity_count} entities`, 'success');
            return;
          } else if (status.status === 'failed') {
            showToast(`Processing failed: ${status.error_message}`, 'error');
            return;
          }
        }

        attempts++;
        if (attempts < maxAttempts) {
          setTimeout(poll, 5000); // Poll every 5 seconds
        }
      } catch (err) {
        console.error('Status poll failed:', err);
      }
    };

    poll();
  };

  // Restore selected document from URL
  useEffect(() => {
    const docId = searchParams.get('doc');
    if (docId && documents.length > 0 && !selectedDocument) {
      const doc = documents.find(d => d.id === docId);
      if (doc) {
        handleSelectDocument(doc);
      }
    }
  }, [documents, searchParams, selectedDocument]);

  // Helpers
  const getFileIcon = (type) => {
    const icons = {
      pdf: '/assets/icons/pdf.png',
      xlsx: '/assets/icons/data-discovery.png',
      xls: '/assets/icons/data-discovery.png',
      csv: '/assets/icons/data-discovery.png',
      txt: '/assets/icons/document.png',
      doc: '/assets/icons/word.png',
      docx: '/assets/icons/word.png',
      json: '/assets/icons/database.png',
    };
    return icons[type] || '/assets/icons/document.png';
  };

  const getStatusColor = (status) => {
    const colors = { completed: 'success', processing: 'warning', failed: 'error' };
    return colors[status] || 'default';
  };

  const getConfidenceColor = (confidence) => {
    if (confidence >= 0.9) return 'high';
    if (confidence >= 0.7) return 'medium';
    return 'low';
  };

  // Business-friendly label instead of a raw percentage - a "confidence
  // score" reads as ML/data-science jargon to a non-technical user, and the
  // exact number implies a precision the underlying model doesn't actually
  // have. Same high/medium/low buckets getConfidenceColor already uses.
  const getConfidenceLabel = (confidence) => {
    if (confidence >= 0.9) return 'High';
    if (confidence >= 0.7) return 'Medium';
    return 'Low';
  };

  const getTotalStats = () => {
    const completed = documents.filter(d => d.status === 'completed');
    return {
      totalDocs: documents.length,
      completedDocs: completed.length,
      processingDocs: documents.filter(d => d.status === 'processing').length,
      totalEntities: completed.reduce((sum, d) => sum + (d.entities || 0), 0),
      totalRelationships: completed.reduce((sum, d) => sum + (d.relationships || 0), 0),
      avgConfidence: completed.length > 0
        ? completed.reduce((sum, d) => sum + (d.confidence || 0), 0) / completed.length
        : 0,
    };
  };

  // Fetch (generate) structured analysis for a real, live document
  const fetchDocumentInsight = async (documentId) => {
    setIsLoadingInsight(true);
    setCurrentInsight(null);
    try {
      const res = await fetch(`${DOC_API}/documents/${documentId}/insight?project_id=${selectedProjectId}`, {
        headers: authOptionalHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setCurrentInsight(data);
      } else {
        showToast('Failed to generate document analysis', 'error');
      }
    } catch (err) {
      console.error('Failed to fetch document insight:', err);
      showToast('Failed to generate document analysis', 'error');
    } finally {
      setIsLoadingInsight(false);
    }
  };

  // Handlers
  const handleSelectDocument = (doc) => {
    setSelectedDocument(doc);
    setActiveView('analysis');
    setAnalysisTab('insights');

    if (doc.status === 'completed') {
      fetchDocumentInsight(doc.id);
    } else {
      setCurrentInsight(null);
    }
  };

  const handleFileUpload = (e) => {
    let selectedFiles = Array.from(e.target.files);
    if (isBulkMode) {
      if (selectedFiles.length > 10) {
        showToast('Maximum 10 files allowed', 'warning');
        selectedFiles = selectedFiles.slice(0, 10);
      }
    } else {
      selectedFiles = selectedFiles.slice(0, 1);
    }
    setFiles(selectedFiles);
  };

  const handleUploadFiles = async () => {
    if (files.length === 0) return;

    // Validate file types
    const invalidFiles = files.filter(f => {
      const ext = f.name.split('.').pop()?.toLowerCase();
      return !ALLOWED_EXTENSIONS.includes(ext);
    });

    if (invalidFiles.length > 0) {
      showToast(`Unsupported file type. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`, 'error');
      return;
    }

    setIsUploading(true);

    // Upload to backend API
    const uploadedDocIds = [];

    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('project_id', selectedProjectId);

        const response = await fetch(`${DOC_API}/upload`, {
          method: 'POST',
          headers: authOptionalHeaders(),
          body: formData,
        });

        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.error || 'Upload failed');
        }

        const result = await response.json();
        uploadedDocIds.push(result.document_id);

        // Add to documents list immediately with processing status
        const newDoc = {
          id: result.document_id,
          name: result.file_name,
          type: file.name.split('.').pop()?.toLowerCase() || 'unknown',
          size: formatFileSize(result.file_size),
          uploadedAt: new Date().toISOString().split('T')[0],
          category: 'other',
          pages: null,
          status: 'processing',
          entities: 0,
          relationships: 0,
          confidence: 0,
        };

        setDocuments(prev => [newDoc, ...prev]);
      }

      setFiles([]);
      showToast(`${files.length} file(s) uploaded - processing started`, 'success');

      // Start polling for each document
      uploadedDocIds.forEach(docId => pollDocumentStatus(docId));

    } catch (error) {
      console.error('Upload error:', error);
      showToast(`Upload failed: ${error.message}`, 'error');
    } finally {
      setIsUploading(false);
    }
  };

  const handleAskQuestion = async () => {
    if (!selectedDocument || !inputPrompt.trim()) {
      showToast('Please select a document and enter a question', 'warning');
      return;
    }

    setIsLoading(true);

    // Add to conversation
    const userMessage = { role: 'user', content: inputPrompt, timestamp: new Date() };
    setConversationHistory(prev => [...prev, userMessage]);

    // Use document intelligence chat API
    try {
      const response = await fetch(`${DOC_API}/chat`, {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({
          query: inputPrompt,
          document_ids: [selectedDocument.id],
          project_id: selectedProjectId,
          use_entity_boost: true,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Chat failed');
      }

      const data = await response.json();

      // Format sources from backend response
      const formattedSources = (data.sources || []).map(s => ({
        page: s.page_number || 1,
        text: s.content?.substring(0, 100) || '',
        relevance: s.score || 0.8,
      }));

      // Calculate confidence from source relevance scores
      const avgConfidence = formattedSources.length > 0
        ? formattedSources.reduce((sum, s) => sum + s.relevance, 0) / formattedSources.length
        : 0.75;

      const aiResponse = {
        role: 'assistant',
        content: data.answer,
        timestamp: new Date(),
        sources: formattedSources,
        confidence: avgConfidence,
        chunkCount: data.chunk_count,
      };

      setConversationHistory(prev => [...prev, aiResponse]);
      setInputPrompt('');

      // Save to workflow if in workflow context
      if (isInWorkflow) {
        // Extract key findings from answer (split by bullet points or newlines)
        const answerLines = data.answer.split('\n').filter(line => line.trim());
        const keyFindings = answerLines.slice(0, 5).map(line => line.replace(/^[•\-*]\s*/, '').trim());

        saveStageData({
          document_analyzed: selectedDocument.name,
          analysis_query: inputPrompt,
          key_findings: keyFindings.length > 0 ? keyFindings : [data.answer.substring(0, 200)],
          recommendations: [],
          sources: formattedSources.map(s => `Page ${s.page}: ${s.text}`),
          confidence_score: Math.round(avgConfidence * 100) / 100,
        });
      }
    } catch (error) {
      console.error('Chat error:', error);
      showToast(`Failed to get response: ${error.message}`, 'error');

      // Add error message to conversation
      const errorResponse = {
        role: 'assistant',
        content: `Sorry, I couldn't process your question. Error: ${error.message}`,
        timestamp: new Date(),
        sources: [],
        confidence: 0,
      };
      setConversationHistory(prev => [...prev, errorResponse]);
    } finally {
      setIsLoading(false);
    }
  };

  // State for live mode entities
  const [liveEntities, setLiveEntities] = useState([]);
  const [liveEntitiesByType, setLiveEntitiesByType] = useState(null);

  // Fetch entities for document
  const fetchDocumentEntities = async (documentId) => {
    try {
      const res = await fetch(`${DOC_API}/status/${documentId}?project_id=${selectedProjectId}`, {
        headers: authOptionalHeaders(),
      });

      if (res.ok) {
        const data = await res.json();
        // Backend returns entities with the status - format them
        if (data.entities) {
          const formatted = Object.entries(data.entities).flatMap(([type, names]) =>
            names.map((name, idx) => ({
              id: `${type}-${idx}`,
              name,
              type,
              confidence: 0.8,
            }))
          );
          setLiveEntities(formatted);
          setLiveEntitiesByType(data.entities);
        } else {
          setLiveEntities([]);
          setLiveEntitiesByType(null);
        }
      }
    } catch (err) {
      console.error('Failed to fetch entities:', err);
    }
  };

  // Get entities for selected document
  const getDocumentEntities = () => {
    if (!selectedDocument) return [];
    // Structured entity extraction (with page/type) isn't available for a
    // synthetic workflow document, or before the real pipeline finishes -
    // fall back to the flat key facts we already have so the tab isn't
    // just empty when we actually do have something to show.
    if (liveEntities.length === 0 && currentInsight?.keyFacts?.length > 0) {
      return currentInsight.keyFacts.map((kf, idx) => ({
        id: `fact-${idx}`,
        type: 'finding',
        name: kf.source || `Finding ${idx + 1}`,
        value: kf.fact,
        confidence: kf.confidence,
      }));
    }
    return liveEntities;
  };

  // Fetch entities when document is selected
  useEffect(() => {
    if (selectedDocument && selectedDocument.id !== 'workflow-doc') {
      fetchDocumentEntities(selectedDocument.id);
    }
  }, [selectedDocument]);

  // Load workflow data when viewing completed stage history
  useEffect(() => {
    if (!isHistoryView) return;

    const data = stageData && Object.keys(stageData).length > 0 ? stageData : null;
    console.log('[DataInsights] History view check:', {
      isHistoryView,
      hasStageData: Boolean(data),
      stageDataKeys: data ? Object.keys(data) : [],
      stageData: stageData
    });

    if (!data) {
      console.warn('[DataInsights] No stage data available - stage may not have been executed or no data was saved');
      // Show empty state message
      setConversationHistory([{
        role: 'assistant',
        content: 'No analysis data was saved for this stage. The stage may not have been completed yet.',
        timestamp: new Date()
      }]);
      setActiveView('chat');
      return;
    }

    console.log('[DataInsights] Loading workflow history data');

    // Load saved conversation/analysis from stageData
    // Handle both document_analyzed (singular) and documents_analyzed (plural, count)
    const docName = data.document_analyzed || (data.documents_analyzed ? `${data.documents_analyzed} documents` : null);

    // Backward compatibility: handle old data structure with answer_summary
    const keyFindings = data.key_findings || (data.answer_summary ? [data.answer_summary] : []);
    const hasData = docName || keyFindings.length > 0 || data.analysis_query;

    if (hasData) {
      // Create a synthetic document for display purposes
      const syntheticDoc = {
        id: 'workflow-doc',
        name: docName || 'Workflow Documents',
        type: 'pdf',
        size: 'N/A',
        uploadedAt: stageData.completedAt || 'N/A',
        category: 'workflow',
        pages: null,
        status: 'completed',
        entities: keyFindings.length || 0,
        relationships: 0,
        confidence: data.confidence_score || 0.9,
      };
      setSelectedDocument(syntheticDoc);
      setDocuments([syntheticDoc]); // Add to documents list so it shows in library

      // Set the current insight from saved data
      setCurrentInsight({
        summary: `Analysis of ${docName || 'workflow documents'}`,
        keyFacts: keyFindings.map((fact, idx) => ({
          fact,
          confidence: data.confidence_score || 0.9,
          source: `Finding ${idx + 1}`,
        })),
        recommendations: data.recommendations || [],
        sources: data.sources || [],
      });

      // Add to conversation history
      const findings = keyFindings.map(f => `• ${f}`).join('\n');
      const recs = (data.recommendations || []).map(r => `• ${r}`).join('\n');
      const query = data.analysis_query ? `**Question:** ${data.analysis_query}\n\n` : '';

      setConversationHistory([
        {
          role: 'assistant',
          content: `**Stage Completed:** ${docName || 'Documents analyzed'}\n\n${query}${findings ? `**Key Findings:**\n${findings}` : ''}${recs ? `\n\n**Recommendations:**\n${recs}` : ''}`,
          timestamp: new Date(stageData.completedAt || Date.now()),
          confidence: data.confidence_score || 0.9,
        },
      ]);

      // Switch to analysis view to show the data
      setActiveView('analysis');
    }
  }, [isHistoryView, stageData]);

  // Get graph for selected document
  // Builds a real graph from the document's extracted entities (grouped by
  // type, e.g. email/money/date). There's no LLM-derived relationship data
  // to draw on, so edges connect each entity to a hub node for its type
  // rather than asserting a specific (and potentially false) relationship
  // between entities.
  const buildLiveGraph = (entitiesByType) => {
    const types = Object.keys(entitiesByType || {}).filter(t => entitiesByType[t]?.length > 0).slice(0, 5);
    if (types.length === 0) return null;

    const centerX = 200;
    const centerY = 175;
    const hubRadius = 90;
    const leafRadius = 150;
    const nodes = [];
    const edges = [];

    types.forEach((type, typeIdx) => {
      const typeAngle = (typeIdx / types.length) * 2 * Math.PI;
      const hubId = `hub-${type}`;
      nodes.push({
        id: hubId,
        label: type.charAt(0).toUpperCase() + type.slice(1),
        type,
        x: Math.round(centerX + hubRadius * Math.cos(typeAngle)),
        y: Math.round(centerY + hubRadius * Math.sin(typeAngle)),
      });

      const names = [...new Set(entitiesByType[type])].slice(0, 4);
      const spread = Math.PI / 4;
      names.forEach((name, nameIdx) => {
        const offset = names.length > 1 ? (nameIdx / (names.length - 1) - 0.5) * spread : 0;
        const angle = typeAngle + offset;
        const leafId = `${type}-${nameIdx}`;
        nodes.push({
          id: leafId,
          label: name.length > 18 ? `${name.slice(0, 16)}…` : name,
          type,
          x: Math.round(centerX + leafRadius * Math.cos(angle)),
          y: Math.round(centerY + leafRadius * Math.sin(angle)),
        });
        edges.push({ source: hubId, target: leafId, label: '' });
      });
    });

    return { nodes, edges };
  };

  const getDocumentGraph = () => {
    if (!selectedDocument) return null;
    if (liveEntitiesByType && Object.keys(liveEntitiesByType).length > 0) {
      return buildLiveGraph(liveEntitiesByType);
    }
    // The backend only returns a structured entities-by-type map when its
    // extraction step produced clean entity rows; a document can finish
    // processing with only flat key facts. Group whatever getDocumentEntities()
    // already surfaces (which has its own keyFacts fallback) so the graph tab
    // isn't empty whenever the Key Facts tab has content.
    const flatEntities = getDocumentEntities();
    if (flatEntities.length === 0) return null;
    const groupedByType = flatEntities.reduce((acc, entity) => {
      const key = entity.type || 'other';
      if (!acc[key]) acc[key] = [];
      acc[key].push(entity.name);
      return acc;
    }, {});
    return buildLiveGraph(groupedByType);
  };

  const stats = getTotalStats();

  return (
    <div className="data-insights-page">
      <Header />

      <div className="agent-page-header">
        <div className="agent-header-left">
          {!isInWorkflow && <BackButton />}
          <div className="agent-header-content">
            <div className="agent-title-row">
              <h1>Data Insights</h1>
            </div>
            <p className="text-muted">
              {selectedDocument
                ? `Analyzing: ${selectedDocument.name}`
                : 'Upload documents and get instant answers from your data'}
            </p>
          </div>
        </div>
        <div className="agent-header-right">
          <ProjectSelector agentKey="dataInsights" />
        </div>
      </div>

      <AgentOutcomesStrip
        items={[
          { iconSrc: '/assets/icons/bar-chart.png', title: 'Smart Q&A', description: 'Ask questions, get sourced answers.' },
          { iconSrc: '/assets/icons/data-discovery.png', title: 'Key Facts', description: 'Auto-extract key facts and metrics.' },
          { iconSrc: '/assets/icons/performance.png', title: 'Visual Connections', description: 'Visualize relationships in your data.' },
        ]}
      />

      <LiveModeHint
        requireProject
        message="Choose a project, then upload documents or switch to Demo for sample data."
      />

      <ProjectGate agentLabel="Data Insights workspace">
        <div className="di-container">
          <WorkflowExecutionBanner />

          {/* Show context from previous workflow stages */}
          {isInWorkflow && !isHistoryView && (
            <WorkflowContextCard context={getContext()} currentStageId={stageId} />
          )}

          {/* Read-Only History View Warning */}
          {isHistoryView && (
            <div className="workflow-history-banner">
              <span style={{fontSize: '20px'}}>🔒</span>
              <div>
                <strong>Read-Only Mode:</strong> Viewing completed workflow stage.
                All modifications are disabled to preserve workflow history.
              </div>
            </div>
          )}

          {/* Overall Stats Strip */}
          {documents.length > 0 && (
            <div className="di-overall-stats">
              <div className="di-stat-item">
                <div className="di-stat-icon">
                  <img src="/assets/icons/bar-chart.png" alt="" width={20} height={20} />
                </div>
                <div className="di-stat-content">
                  <span className="di-stat-value">{stats.totalDocs}</span>
                  <span className="di-stat-label">Documents</span>
                </div>
              </div>
              <div className="di-stat-item">
                <div className="di-stat-icon di-stat-icon--success">
                  <img src="/assets/icons/performance.png" alt="" width={20} height={20} />
                </div>
                <div className="di-stat-content">
                  <span className="di-stat-value">{stats.completedDocs}</span>
                  <span className="di-stat-label">Processed</span>
                </div>
              </div>
              <div className="di-stat-item">
                <div className="di-stat-icon di-stat-icon--accent">
                  <img src="/assets/icons/data-discovery.png" alt="" width={20} height={20} />
                </div>
                <div className="di-stat-content">
                  <span className="di-stat-value">{stats.totalEntities}</span>
                  <span className="di-stat-label">Key Facts</span>
                </div>
              </div>
              <div className="di-stat-item">
                <div className="di-stat-icon di-stat-icon--primary">
                  <img src="/assets/icons/networking.png" alt="" width={20} height={20} />
                </div>
                <div className="di-stat-content">
                  <span className="di-stat-value">{stats.totalRelationships}</span>
                  <span className="di-stat-label">Relations</span>
                </div>
              </div>
              <div className="di-stat-item">
                <div className="di-stat-icon di-stat-icon--info">
                  <img src="/assets/icons/search-analysis.png" alt="" width={20} height={20} />
                </div>
                <div className="di-stat-content">
                  <span className="di-stat-value">{getConfidenceLabel(stats.avgConfidence)}</span>
                  <span className="di-stat-label">Confidence</span>
                </div>
              </div>
            </div>
          )}

          {/* Main View Tabs */}
          <div className="di-main-tabs">
            <button
              className={`di-main-tab ${activeView === 'library' ? 'di-main-tab--active' : ''}`}
              onClick={() => setActiveView('library')}
              title="Document Library - Upload and manage your documents"
            >
              <img src="/assets/icons/bar-chart.png" alt="Library icon" className="di-tab-icon" />
              Library
            </button>
            <button
              className={`di-main-tab ${activeView === 'analysis' ? 'di-main-tab--active' : ''}`}
              onClick={() => selectedDocument && setActiveView('analysis')}
              disabled={!selectedDocument}
              title={!selectedDocument ? 'Select a document from Library first' : 'Analysis - View extracted key facts and visual connections'}
            >
              <img src="/assets/icons/data-discovery.png" alt="Analysis icon" className="di-tab-icon" />
              Analysis
              {selectedDocument && <span className="di-tab-doc">{selectedDocument.name.substring(0, 15)}...</span>}
            </button>
            <button
              className={`di-main-tab ${activeView === 'chat' ? 'di-main-tab--active' : ''}`}
              onClick={() => selectedDocument && setActiveView('chat')}
              disabled={!selectedDocument}
              title={!selectedDocument ? 'Select a document from Library first' : 'Smart Q&A - Ask questions about your document'}
            >
              <img src="/assets/icons/ai-chatbots.png" alt="Ask AI icon" className="di-tab-icon" />
              Ask AI
            </button>
          </div>

          {/* Views */}
          {activeView === 'library' && (
            <div className="di-library-view">
              <div className="di-library-layout">
                {/* Upload Panel */}
                <div className="di-upload-panel">
                  <div className="di-panel-header">
                    <h3>Upload Documents</h3>
                    <label className="di-bulk-toggle" style={isHistoryView ? {opacity: 0.5, cursor: 'not-allowed'} : {}}>
                      <input
                        type="checkbox"
                        checked={isBulkMode}
                        onChange={(e) => { setIsBulkMode(e.target.checked); setFiles([]); }}
                        disabled={isHistoryView}
                      />
                      Bulk
                    </label>
                  </div>

                  <div className="di-upload-zone" style={isHistoryView ? {opacity: 0.5, pointerEvents: 'none', cursor: 'not-allowed'} : {}}>
                    <input
                      type="file"
                      id="file-input"
                      onChange={handleFileUpload}
                      multiple={isBulkMode}
                      accept=".pdf,.csv,.xlsx,.xls,.txt,.json"
                      className="di-file-input"
                      disabled={isHistoryView}
                    />
                    <label htmlFor="file-input" className="di-upload-label">
                      <div className="di-upload-icon">+</div>
                      <span>{isHistoryView ? '🔒 Upload disabled - viewing completed stage' : 'Drop files or click to upload'}</span>
                      <span className="di-upload-formats">PDF, CSV, XLSX, TXT, JSON</span>
                    </label>
                  </div>

                  {files.length > 0 && (
                    <div className="di-pending-files">
                      <div className="di-pending-header">
                        <span>{files.length} file(s) ready</span>
                        <button onClick={() => setFiles([])}>×</button>
                      </div>
                      <ul>{files.map((f, i) => <li key={i}>{f.name}</li>)}</ul>
                      <button className="di-upload-btn" onClick={handleUploadFiles} disabled={isUploading || isHistoryView}>
                        {isUploading ? 'Uploading...' : 'Upload & Process'}
                      </button>
                    </div>
                  )}

                  {/* Processing Status */}
                  {stats.processingDocs > 0 && (
                    <div className="di-processing-status">
                      <div className="di-processing-header">
                        <span className="di-processing-spinner" />
                        <span>Processing {stats.processingDocs} document(s)...</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Documents Grid */}
                <div className="di-documents-panel">
                  <div className="di-panel-header">
                    <h3>Document Library</h3>
                    <span className="di-doc-count">{documents.length} files</span>
                  </div>

                  {documents.length === 0 ? (
                    <EmptyState
                      iconType="document"
                      title="No documents yet"
                      description="Upload documents to start extracting insights with AI."
                    />
                  ) : (
                    <div className="di-doc-grid">
                      {documents.map(doc => (
                        <div
                          key={doc.id}
                          className={`di-doc-card ${selectedDocument?.id === doc.id ? 'di-doc-card--selected' : ''} ${doc.status === 'processing' ? 'di-doc-card--processing' : ''}`}
                          onClick={() => doc.status === 'completed' && handleSelectDocument(doc)}
                        >
                          <div className="di-doc-header">
                            <div className={`di-doc-icon di-doc-icon--${doc.category}`}>
                              <img src={getFileIcon(doc.type)} alt="" />
                            </div>
                            <span className={`di-doc-status di-doc-status--${doc.status}`} />
                          </div>
                          <h4 className="di-doc-name">{doc.name}</h4>
                          <div className="di-doc-meta">
                            <span>{doc.type.toUpperCase()}</span>
                            <span>•</span>
                            <span>{doc.size}</span>
                          </div>
                          {doc.status === 'completed' && (
                            <div className="di-doc-stats">
                              <span>{doc.entities} entities</span>
                              <span>•</span>
                              <span>{getConfidenceLabel(doc.confidence)} confidence</span>
                            </div>
                          )}
                          {doc.status === 'completed' && (
                            <button className="di-doc-analyze-btn">Analyze</button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeView === 'analysis' && selectedDocument && (
            <div className="di-analysis-view">
              {/* Document Header */}
              <div className="di-analysis-header">
                <div className="di-analysis-doc">
                  <div className={`di-doc-icon di-doc-icon--${selectedDocument.category}`}>
                    <img src={getFileIcon(selectedDocument.type)} alt="" />
                  </div>
                  <div className="di-analysis-doc-info">
                    <h3>{selectedDocument.name}</h3>
                    <span>{selectedDocument.type.toUpperCase()} • {selectedDocument.size} • {selectedDocument.pages} pages</span>
                  </div>
                </div>
                <div className="di-analysis-badges">
                  <span className="di-badge di-badge--entities">{selectedDocument.entities} entities</span>
                  <span className="di-badge di-badge--relations">{selectedDocument.relationships} relations</span>
                  <span className={`di-badge di-badge--confidence di-badge--${getConfidenceColor(selectedDocument.confidence)}`}>
                    {getConfidenceLabel(selectedDocument.confidence)} confidence
                  </span>
                </div>
                <button className="di-change-doc" onClick={() => setActiveView('library')}>Change Document</button>
              </div>

              {/* Analysis Sub-tabs */}
              <div className="di-analysis-tabs">
                <button
                  className={`di-analysis-tab ${analysisTab === 'insights' ? 'di-analysis-tab--active' : ''}`}
                  onClick={() => setAnalysisTab('insights')}
                >
                  Key Insights
                </button>
                <button
                  className={`di-analysis-tab ${analysisTab === 'entities' ? 'di-analysis-tab--active' : ''}`}
                  onClick={() => setAnalysisTab('entities')}
                >
                  Key Facts ({getDocumentEntities().length})
                </button>
                <button
                  className={`di-analysis-tab ${analysisTab === 'graph' ? 'di-analysis-tab--active' : ''}`}
                  onClick={() => setAnalysisTab('graph')}
                >
                  Visual Connections
                </button>
                <button
                  className={`di-analysis-tab ${analysisTab === 'sources' ? 'di-analysis-tab--active' : ''}`}
                  onClick={() => setAnalysisTab('sources')}
                >
                  Sources
                </button>
              </div>

              {/* Analysis Content */}
              <div className="di-analysis-content">
                {analysisTab === 'insights' && isLoadingInsight && (
                  <div className="di-processing-status">
                    <div className="di-processing-header">
                      <span className="di-processing-spinner" />
                      <span>Generating analysis from document content...</span>
                    </div>
                  </div>
                )}
                {analysisTab === 'insights' && !isLoadingInsight && !currentInsight && (
                  <EmptyState
                    iconType="document"
                    title="No analysis available yet"
                    description="Select a completed document to generate its analysis."
                  />
                )}
                {analysisTab === 'insights' && !isLoadingInsight && currentInsight && (
                  <div className="di-insights-panel">
                    <div className="di-insights-summary">
                      <h4>{currentInsight.summary}</h4>
                    </div>

                    <div className="di-key-facts">
                      <h5>Key Facts</h5>
                      <ul>
                        {currentInsight.keyFacts.map((kf, idx) => (
                          <li key={idx} className="di-fact-item">
                            <span className="di-fact-text">{kf.fact}</span>
                            <div className="di-fact-meta">
                              <span className={`di-fact-confidence di-fact-confidence--${getConfidenceColor(kf.confidence)}`}>
                                {getConfidenceLabel(kf.confidence)}
                              </span>
                              <span className="di-fact-source">{kf.source}</span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="di-recommendations">
                      <h5>Recommendations</h5>
                      <ul>
                        {currentInsight.recommendations.map((rec, idx) => (
                          <li key={idx}>{rec}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}

                {analysisTab === 'entities' && isLoadingInsight && (
                  <div className="di-processing-status">
                    <div className="di-processing-header">
                      <span className="di-processing-spinner" />
                      <span>Generating analysis from document content...</span>
                    </div>
                  </div>
                )}
                {analysisTab === 'entities' && !isLoadingInsight && (
                  <div className="di-entities-panel">
                    {getDocumentEntities().length > 0 ? (
                      <div className="di-entity-grid">
                        {getDocumentEntities().map(entity => (
                          <div key={entity.id} className={`di-entity-card di-entity-card--${entity.type}`}>
                            <div className="di-entity-header">
                              <span className="di-entity-type">{entity.type}</span>
                              <span className={`di-entity-confidence di-entity-confidence--${getConfidenceColor(entity.confidence)}`}>
                                {getConfidenceLabel(entity.confidence)}
                              </span>
                            </div>
                            <div className="di-entity-name">{entity.name}</div>
                            {entity.value && <div className="di-entity-value">{entity.value}</div>}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <EmptyState
                        iconType="document"
                        title="No key facts extracted yet"
                        description="Structured facts will appear here once document processing finishes."
                      />
                    )}
                  </div>
                )}

                {analysisTab === 'graph' && (
                  <div className="di-graph-panel">
                    {getDocumentGraph() ? (
                      <div className="di-graph-container">
                        <div className="di-graph-header">
                          <h5>Visual Connections</h5>
                          <span>{getDocumentGraph().nodes.length} items • {getDocumentGraph().edges.length} connections</span>
                        </div>
                        <div className="di-graph-canvas">
                          <svg viewBox="0 0 400 350" className="di-graph-svg">
                            {/* Edges */}
                            {getDocumentGraph().edges.map((edge, idx) => {
                              const source = getDocumentGraph().nodes.find(n => n.id === edge.source);
                              const target = getDocumentGraph().nodes.find(n => n.id === edge.target);
                              if (!source || !target) return null;
                              return (
                                <g key={idx}>
                                  <line
                                    x1={source.x}
                                    y1={source.y}
                                    x2={target.x}
                                    y2={target.y}
                                    className="di-graph-edge"
                                  />
                                  <text
                                    x={(source.x + target.x) / 2}
                                    y={(source.y + target.y) / 2 - 5}
                                    className="di-graph-edge-label"
                                  >
                                    {edge.label}
                                  </text>
                                </g>
                              );
                            })}
                            {/* Nodes */}
                            {getDocumentGraph().nodes.map(node => (
                              <g key={node.id}>
                                <circle
                                  cx={node.x}
                                  cy={node.y}
                                  r={25}
                                  className={`di-graph-node di-graph-node--${node.type}`}
                                />
                                <text x={node.x} y={node.y + 4} className="di-graph-node-label">
                                  {node.label}
                                </text>
                              </g>
                            ))}
                          </svg>
                        </div>
                        <div className="di-graph-legend">
                          {[...new Set(getDocumentGraph().nodes.map(n => n.type))].map(type => (
                            <span key={type}>
                              <span className={`di-legend-dot di-legend-dot--${type}`}></span>
                              {' '}{type.charAt(0).toUpperCase() + type.slice(1)}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <EmptyState
                        iconType="document"
                        title="No graph available"
                        description="Visual connections will be generated after document processing."
                      />
                    )}
                  </div>
                )}

                {analysisTab === 'sources' && isLoadingInsight && (
                  <div className="di-processing-status">
                    <div className="di-processing-header">
                      <span className="di-processing-spinner" />
                      <span>Generating analysis from document content...</span>
                    </div>
                  </div>
                )}
                {analysisTab === 'sources' && !isLoadingInsight && !currentInsight && (
                  <EmptyState
                    iconType="document"
                    title="No source citations available"
                    description="Select a completed document to generate its analysis."
                  />
                )}
                {analysisTab === 'sources' && !isLoadingInsight && currentInsight && (
                  <div className="di-sources-panel">
                    <h5>Source References</h5>
                    {currentInsight.sources.length > 0 ? (
                      <div className="di-sources-list">
                        {currentInsight.sources.map((source, idx) => (
                          <div key={idx} className="di-source-card">
                            <div className="di-source-header">
                              <span className="di-source-page">Page {source.page}</span>
                              <span className={`di-source-relevance di-source-relevance--${getConfidenceColor(source.relevance)}`}>
                                {getConfidenceLabel(source.relevance)} relevance
                              </span>
                            </div>
                            <p className="di-source-text">"{source.text}"</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <EmptyState
                        iconType="document"
                        title="No source citations available"
                        description="Page-level citations will appear here once document processing finishes."
                      />
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeView === 'chat' && selectedDocument && (
            <div className="di-chat-view">
              {/* Chat Header */}
              <div className="di-chat-header">
                <div className="di-chat-doc">
                  <div className={`di-doc-icon di-doc-icon--${selectedDocument.category}`}>
                    <img src={getFileIcon(selectedDocument.type)} alt="" />
                  </div>
                  <span>Asking about: <strong>{selectedDocument.name}</strong></span>
                </div>
                <button className="di-change-doc" onClick={() => setActiveView('library')}>Change</button>
              </div>

              {/* Chat Messages */}
              <div className="di-chat-messages">
                {conversationHistory.length === 0 && (
                  <div className="di-chat-welcome">
                    <h4>Ask anything about this document</h4>
                    <p>I'll analyze the content and provide answers with source references.</p>
                    <div className="di-suggested-prompts">
                      {SUGGESTED_PROMPTS.slice(0, 4).map((prompt, idx) => (
                        <button key={idx} onClick={() => setInputPrompt(prompt)}>
                          {prompt}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {conversationHistory.map((msg, idx) => (
                  <div key={idx} className={`di-chat-message di-chat-message--${msg.role}`}>
                    <div className="di-message-content">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                    {msg.sources && msg.sources.length > 0 && (
                      <div className="di-message-sources">
                        <span className="di-sources-label">Sources:</span>
                        {msg.sources.map((s, i) => (
                          <span key={i} className="di-source-chip">Page {s.page}</span>
                        ))}
                      </div>
                    )}
                    {msg.confidence && (
                      <span className="di-message-confidence">{getConfidenceLabel(msg.confidence)} confidence</span>
                    )}
                  </div>
                ))}

                {isLoading && (
                  <div className="di-chat-message di-chat-message--assistant di-chat-message--loading">
                    <div className="di-loading-dots">
                      <span></span><span></span><span></span>
                    </div>
                  </div>
                )}
              </div>

              {/* Enhanced Chat Input */}
              <div className="di-chat-input-container">
                <div className="di-chat-input-wrapper">
                  <div className="di-input-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                  </div>
                  <Textarea
                    placeholder="Ask anything about this document..."
                    value={inputPrompt}
                    onChange={(e) => setInputPrompt(e.target.value)}
                    rows={1}
                    className="di-chat-input-field"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        if (inputPrompt.trim() && !isLoading) {
                          handleAskQuestion();
                        }
                      }
                    }}
                    disabled={isLoading}
                  />
                  <button
                    className={`di-send-btn-icon ${inputPrompt.trim() && !isLoading ? 'di-send-btn-active' : ''}`}
                    onClick={handleAskQuestion}
                    disabled={isLoading || !inputPrompt.trim()}
                    title={isLoading ? STRINGS.COMMON.PROCESSING : 'Send message (Enter)'}
                  >
                    {isLoading ? (
                      <svg className="di-send-spinner" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <circle cx="12" cy="12" r="10" opacity="0.25" />
                        <path d="M12 2 A10 10 0 0 1 22 12" strokeLinecap="round" />
                      </svg>
                    ) : (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M2 21l21-9L2 3v7l15 2-15 2z" />
                      </svg>
                    )}
                  </button>
                </div>
                <div className="di-input-hint">
                  <span className="di-hint-text">
                    <kbd className="di-kbd">↵ Enter</kbd> to send · <kbd className="di-kbd">Shift + ↵</kbd> for new line
                  </span>
                  {inputPrompt.length > 0 && (
                    <span className="di-char-count">{inputPrompt.length} characters</span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </ProjectGate>
    </div>
  );
}

export default DataInsights;
