import { useState, useRef, useEffect, useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import {
  Bot, User, CheckCircle2, AlertTriangle,
  FileText, RefreshCw, Trash2, ArrowRight, Send,
  UploadCloud, Sparkles, History, Layers, X, ShieldAlert, ClipboardCheck
} from 'lucide-react';
import {
  setFormField,
  setRawInputText,
  addChatMessage,
  analyzeComplaintText,
  updateComplaintFromMessage,
  uploadComplaintDocument,
  saveComplaintRecord,
  checkDuplicates,
  clearDuplicateResults,
  resetForm
} from './store/complaintSlice';
import { API_BASE_URL } from './config';

function App() {
  const dispatch = useDispatch();

  const {
    formData,
    rawInputText,
    chatMessages,
    isAnalyzing,
    analysisProgress,
    analysisStepText,
    isSaving,
    notification,
    isDuplicateChecking,
    duplicateResults,
    duplicateCheckError,
    isExtracted,
    completenessScore,
    missingFields,
  } = useSelector((state) => state.complaint);

  const [activeTab, setActiveTab] = useState('new'); 
  const [historyList, setHistoryList] = useState([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState(null);
  const [isDragging, setIsDragging] = useState(false);

  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [pendingPayload, setPendingPayload] = useState(null);

  const chatEndRef = useRef(null);
  const fileInputRef = useRef(null);

  const fetchHistory = useCallback(async () => {
    setIsLoadingHistory(true);
    setHistoryError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/api/complaints`);
      if (!response.ok) throw new Error('Failed to fetch complaints history');
      const data = await response.json();
      setHistoryList(data);
    } catch (err) {
      setHistoryError(err.message);
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

  const handleDeleteComplaint = async (id) => {
    if (!window.confirm("Are you sure you want to delete this complaint record?")) return;
    try {
      const response = await fetch(`${API_BASE_URL}/api/complaints/${id}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to delete complaint');
      setHistoryList((prev) => prev.filter((item) => item.id !== id));
    } catch (err) {
      alert(`Error deleting record: ${err.message}`);
    }
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, isAnalyzing]);

  useEffect(() => {
    if (activeTab === 'history') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: refetch history when the tab is opened
      fetchHistory();
    }
  }, [activeTab, fetchHistory]);

  // ask for missing fields one at a time, then confirm once nothing's left
  useEffect(() => {
    if (!isExtracted || !missingFields) return;
    const lastMessage = chatMessages[chatMessages.length - 1];

    if (missingFields.length > 0) {
      const nextField = missingFields[0];
      const promptText = `I still need "${nextField.replace(/_/g, ' ')}" to complete this complaint. Could you provide it?`;

      if (!lastMessage || lastMessage.text !== promptText) {
        dispatch(addChatMessage({ id: Date.now(), sender: 'ai', text: promptText }));
      }
    } else {
      const completeText = '🎉 All fields are complete! This complaint is fully filled in and ready to save.';
      if (!lastMessage || lastMessage.text !== completeText) {
        dispatch(addChatMessage({ id: Date.now(), sender: 'ai', text: completeText }));
      }
    }
  }, [isExtracted, missingFields]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    dispatch(setFormField({ name, value }));
  };

  // gate on isExtracted so a fresh/reset form doesn't glow before anything's been analyzed
  const isMissing = (field) => isExtracted && missingFields.includes(field);
  const missingGlowClass = (field) =>
    isMissing(field)
      ? 'border-rose-500/70 shadow-[0_0_8px_2px_rgba(244,63,94,0.55)] animate-pulse'
      : 'border-slate-800';

  const handleAnalyze = (textToAnalyze) => {
    const text = textToAnalyze || rawInputText;
    if (!text.trim()) return;

    dispatch(addChatMessage({ id: Date.now(), sender: 'user', text }));
    if (!textToAnalyze) dispatch(setRawInputText(''));

    // after the first extraction, replies go through the update pipeline instead of
    // full re-extraction, which would regenerate the summary and wipe the description
    if (isExtracted) {
      dispatch(updateComplaintFromMessage(text));
      return;
    }

    dispatch(analyzeComplaintText(text));
  };

  const processFile = (file) => {
    if (!file) return;
    dispatch(uploadComplaintDocument(file));
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    processFile(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      processFile(file);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const executeSave = async (payloadData) => {
    setShowDuplicateModal(false);
    setPendingPayload(null);
    await dispatch(saveComplaintRecord(payloadData));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSaving || isDuplicateChecking || !isExtracted || showDuplicateModal) return;

    const payload = {
      ...formData,
      affected_quantity: String(formData.affected_quantity || '')
    };

    // check for duplicates on every save - a stale or skipped check could let one through
    const result = await dispatch(checkDuplicates({
      complaint_description: formData.complaint_description,
      product_name: formData.product_name,
      batch_number: formData.batch_number,
      complaint_type: formData.complaint_type,
    }));

    // fail open if the check itself errors out - don't block saving over a duplicate-service hiccup
    const matches = checkDuplicates.fulfilled.match(result) ? (result.payload.matches || []) : [];
    const hasHighSimilarity = matches.some(
      (dup) => dup.ai_verdict === true || (dup.ai_verdict == null && dup.similarity_pct >= 75)
    );

    if (hasHighSimilarity) {
      setPendingPayload(payload);
      setShowDuplicateModal(true);
      return;
    }

    await executeSave(payload);
  };

  return (
    <div className="h-screen bg-slate-950 text-slate-100 flex flex-col font-sans overflow-hidden">
      {/* Hidden File Input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        accept=".pdf,.docx,.doc,.txt"
        className="hidden"
      />

      {/* Top Header Navigation Bar */}
      <header className="bg-slate-900/80 border-b border-slate-800/80 px-4 py-2.5 flex items-center justify-between shrink-0 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-xl bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-indigo-400" />
          </div>
          <h1 className="text-sm font-bold tracking-wide text-slate-100">Pharma QMS <span className="text-indigo-400 font-normal">Complaint Intelligence</span></h1>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => setActiveTab('new')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'new'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Log Customer Complaint</span>
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'history'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>Complaint History</span>
          </button>
        </div>
      </header>

      {/* MAIN CONTENT VIEW */}
      {activeTab === 'new' ? (
        <main className="flex-1 max-w-[1600px] w-full mx-auto p-3 md:p-4 grid grid-cols-1 lg:grid-cols-12 gap-4 min-h-0 overflow-hidden">
          
          {/* LEFT PANEL: Chat & Drag-Drop Zone */}
          <section className="lg:col-span-5 bg-slate-900/60 border border-slate-800/80 rounded-2xl flex flex-col h-full backdrop-blur-sm overflow-hidden shadow-xl">
            <div className="p-3 border-b border-slate-800/80 bg-slate-900/80 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bot className="w-4 h-4 text-indigo-400" />
                <h2 className="text-xs font-semibold text-slate-200">AI Complaint Assistant</h2>
              </div>
            </div>

            {/* Chat Stream */}
            <div className="flex-1 p-3 overflow-y-auto space-y-3">
              {chatMessages.map((msg) => (
                <div key={msg.id} className={`flex gap-2.5 text-xs ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.sender === 'ai' && (
                    <div className="w-6 h-6 rounded-lg bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center shrink-0 mt-0.5">
                      <Bot className="w-3.5 h-3.5 text-indigo-300" />
                    </div>
                  )}
                  <div className={`p-3 rounded-xl max-w-[85%] leading-relaxed ${
                    msg.sender === 'user'
                      ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-tr-none shadow-md'
                      : 'bg-slate-800/90 border border-slate-700/60 text-slate-200 rounded-tl-none'
                  }`}>
                    <p className="whitespace-pre-wrap">{msg.text}</p>
                  </div>
                  {msg.sender === 'user' && (
                    <div className="w-6 h-6 rounded-lg bg-slate-700 flex items-center justify-center shrink-0 mt-0.5">
                      <User className="w-3.5 h-3.5 text-slate-300" />
                    </div>
                  )}
                </div>
              ))}

              {isAnalyzing && (
                <div className="flex gap-2.5 text-xs justify-start">
                  <div className="w-6 h-6 rounded-lg bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center shrink-0">
                    <Bot className="w-3.5 h-3.5 text-indigo-300 animate-spin" />
                  </div>
                  <div className="p-3 rounded-xl bg-slate-800/90 border border-slate-700/60 text-indigo-300 rounded-tl-none flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-ping" />
                    Extracting text & running AI pipeline...
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <div className="p-3 border-t border-slate-800/80 bg-slate-900/90 space-y-2.5">
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-3 text-center cursor-pointer transition-all flex items-center justify-center gap-3 ${
                  isDragging 
                    ? 'border-indigo-500 bg-indigo-500/10' 
                    : 'border-slate-700 hover:border-slate-500 bg-slate-950/50'
                }`}
              >
                <div className="text-slate-400 shrink-0">
                  <UploadCloud className="w-6 h-6 text-slate-400" />
                </div>
                <div className="text-left text-[11px]">
                  <span className="text-slate-200 font-medium text-xs">Drag & drop document here</span>{' '}
                  <br />
                  <span className="text-indigo-400 hover:underline">or click to browse</span>
                </div>
              </div>

              {/* Creative Visual Extraction Progress Component */}
              {isAnalyzing && (
                <div className="bg-slate-950/80 border border-indigo-500/40 rounded-xl p-2.5 space-y-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-1 text-indigo-300 font-medium">
                      <Sparkles className="w-3 h-3 animate-spin text-indigo-400" />
                      <span>AI Neural Engine Active</span>
                    </div>
                    <span className="text-indigo-400 font-mono font-semibold">{analysisProgress}%</span>
                  </div>
                  
                  <div className="w-full bg-slate-900 h-1.5 rounded-full overflow-hidden border border-slate-800">
                    <div 
                      className="bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-400 h-full rounded-full transition-all duration-300 shadow-[0_0_10px_rgba(99,102,241,0.5)]"
                      style={{ width: `${analysisProgress}%` }}
                    />
                  </div>

                  <div className="text-[10px] text-slate-400 truncate flex items-center gap-1">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    {analysisStepText}
                  </div>
                </div>
              )}

              <div className="relative">
                <textarea
                  rows="2"
                  value={rawInputText}
                  onChange={(e) => dispatch(setRawInputText(e.target.value))}
                  placeholder={isExtracted && missingFields && missingFields.length > 0 ? `Provide value for ${missingFields[0].replace(/_/g, ' ')}...` : "Or type/paste complaint text directly here..."}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500/80 rounded-xl p-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/30 transition-all resize-none"
                />
                {rawInputText && (
                  <button
                    onClick={() => dispatch(setRawInputText(''))}
                    className="absolute top-2 right-2 text-slate-500 hover:text-slate-300 p-1 transition"
                    title="Clear text"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>

              <button
                onClick={() => handleAnalyze()}
                disabled={isAnalyzing || !rawInputText.trim()}
                className="w-full bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-medium py-2 px-3 rounded-xl transition-all shadow-md shadow-indigo-600/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-xs"
              >
                {isAnalyzing ? (
                  <>
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    <span>Processing Text...</span>
                  </>
                ) : (
                  <>
                    <span>{isExtracted && missingFields && missingFields.length > 0 ? `Send ${missingFields[0].replace(/_/g, ' ')}` : 'Analyze Pasted Text'}</span>
                    <ArrowRight className="w-3 h-3 ml-auto" />
                  </>
                )}
              </button>
            </div>
          </section>

          {/* RIGHT PANEL: Extracted Form Fields */}
          <section className="lg:col-span-7 bg-slate-900/60 border border-slate-800/80 rounded-2xl flex flex-col h-full backdrop-blur-sm overflow-hidden shadow-xl">
            <div className="p-3 border-b border-slate-800/80 bg-slate-900/80 space-y-2.5">
              {/* Panel title row */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-emerald-400" />
                  <h2 className="text-xs font-semibold text-slate-200">Review &amp; Edit Extracted Details</h2>
                </div>
                <div className="flex items-center gap-1.5">
                  <ClipboardCheck className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-[11px] text-slate-400">Completeness</span>
                  <span className={`text-[11px] font-bold ${
                    completenessScore === 100 ? 'text-emerald-400' :
                    completenessScore >= 60  ? 'text-amber-400'   : 'text-rose-400'
                  }`}>{completenessScore}%</span>
                </div>
              </div>

              {/* Completeness progress bar */}
              <div className="w-full bg-slate-950 h-1.5 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    completenessScore === 100
                      ? 'bg-gradient-to-r from-emerald-500 to-teal-400'
                      : completenessScore >= 60
                        ? 'bg-gradient-to-r from-amber-500 to-yellow-400'
                        : 'bg-gradient-to-r from-rose-600 to-orange-500'
                  }`}
                  style={{ width: `${completenessScore}%` }}
                />
              </div>

              {/* All-clear badge */}
              {completenessScore === 100 && (
                <div className="flex items-center gap-1.5 text-emerald-400 text-[11px]">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>All critical fields filled — ready to save!</span>
                </div>
              )}
            </div>

            {notification && (
              <div className={`mx-4 mt-3 p-2.5 rounded-xl border flex items-center gap-2 text-xs animate-in fade-in ${
                notification.type === 'success'
                  ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                  : 'bg-rose-950/40 border-rose-500/40 text-rose-300'
              }`}>
                {notification.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" /> : <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />}
                <span className="flex-1">{notification.text}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} autoComplete="off" className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
              
              <div className="space-y-2">
                <h3 className="font-bold uppercase tracking-wider text-indigo-400 text-[10px]">1. Overview & Source</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-slate-300 mb-1">Ref No *</label>
                    <input type="text" name="complaint_ref_no" value={formData.complaint_ref_no} onChange={handleInputChange} className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none" required />
                  </div>
                  <div>
                    <label className="block text-slate-300 mb-1">Source</label>
                    <input type="text" name="complaint_source" value={formData.complaint_source} onChange={handleInputChange} className={`w-full bg-slate-950 border rounded-xl px-3 py-2 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none transition-shadow ${missingGlowClass('complaint_source')}`} />
                  </div>
                  <div>
                    <label className="block text-slate-300 mb-1">Complaint Date</label>
                    <input type="text" name="complaint_date" value={formData.complaint_date} onChange={handleInputChange} className={`w-full bg-slate-950 border rounded-xl px-3 py-2 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none transition-shadow ${missingGlowClass('complaint_date')}`} />
                  </div>
                </div>
              </div>

              <div className="space-y-2 pt-3 border-t border-slate-800/60">
                <h3 className="font-bold uppercase tracking-wider text-indigo-400 text-[10px]">2. Customer & Product Info</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-300 mb-1">Customer Name</label>
                    <input type="text" name="customer_name" value={formData.customer_name} onChange={handleInputChange} placeholder="e.g. John Doe" className={`w-full bg-slate-950 border rounded-xl px-3 py-2 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none transition-shadow ${missingGlowClass('customer_name')}`} />
                  </div>
                  <div>
                    <label className="block text-slate-300 mb-1">Product Name</label>
                    <input type="text" name="product_name" value={formData.product_name} onChange={handleInputChange} placeholder="e.g. Paracetamol" className={`w-full bg-slate-950 border rounded-xl px-3 py-2 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none transition-shadow ${missingGlowClass('product_name')}`} />
                  </div>
                  <div>
                    <label className="block text-slate-300 mb-1">Product Strength</label>
                    <input type="text" name="product_strength" value={formData.product_strength} onChange={handleInputChange} placeholder="e.g. 500mg" className={`w-full bg-slate-950 border rounded-xl px-3 py-2 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none transition-shadow ${missingGlowClass('product_strength')}`} />
                  </div>
                  <div>
                    <label className="block text-slate-300 mb-1">Batch Number</label>
                    <input type="text" name="batch_number" value={formData.batch_number} onChange={handleInputChange} placeholder="e.g. PT-9042" className={`w-full bg-slate-950 border rounded-xl px-3 py-2 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none transition-shadow ${missingGlowClass('batch_number')}`} />
                  </div>
                </div>
              </div>

              <div className="space-y-2 pt-3 border-t border-slate-800/60">
                <h3 className="font-bold uppercase tracking-wider text-indigo-400 text-[10px]">3. Dates & Quantities</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-slate-300 mb-1">Manufacturing Date</label>
                    <input type="text" name="manufacturing_date" value={formData.manufacturing_date} onChange={handleInputChange} className={`w-full bg-slate-950 border rounded-xl px-3 py-2 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none transition-shadow ${missingGlowClass('manufacturing_date')}`} />
                  </div>
                  <div>
                    <label className="block text-slate-300 mb-1">Expiry Date</label>
                    <input type="text" name="expiry_date" value={formData.expiry_date} onChange={handleInputChange} className={`w-full bg-slate-950 border rounded-xl px-3 py-2 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none transition-shadow ${missingGlowClass('expiry_date')}`} />
                  </div>
                  <div>
                    <label className="block text-slate-300 mb-1">Affected Quantity</label>
                    <input type="text" name="affected_quantity" value={formData.affected_quantity} onChange={handleInputChange} className={`w-full bg-slate-950 border rounded-xl px-3 py-2 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none transition-shadow ${missingGlowClass('affected_quantity')}`} />
                  </div>
                </div>
              </div>

              <div className="space-y-2 pt-3 border-t border-slate-800/60">
                <h3 className="font-bold uppercase tracking-wider text-indigo-400 text-[10px]">4. Classification & Triage</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-slate-300 mb-1">Originating Block</label>
                    <input type="text" name="originating_block" value={formData.originating_block} onChange={handleInputChange} className={`w-full bg-slate-950 border rounded-xl px-3 py-2 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none transition-shadow ${missingGlowClass('originating_block')}`} />
                  </div>
                  <div>
                    <label className="block text-slate-300 mb-1">Impacted NPM</label>
                    <input type="text" name="impacted_npm" value={formData.impacted_npm} onChange={handleInputChange} className={`w-full bg-slate-950 border rounded-xl px-3 py-2 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none transition-shadow ${missingGlowClass('impacted_npm')}`} />
                  </div>
                  <div>
                    <label className="block text-slate-300 mb-1">Complaint Type</label>
                    <input type="text" name="complaint_type" value={formData.complaint_type} onChange={handleInputChange} className={`w-full bg-slate-950 border rounded-xl px-3 py-2 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none transition-shadow ${missingGlowClass('complaint_type')}`} />
                  </div>
                  <div>
                    <label className="block text-slate-300 mb-1">Initial Severity</label>
                    <input type="text" name="initial_severity" value={formData.initial_severity} onChange={handleInputChange} className={`w-full bg-slate-950 border rounded-xl px-3 py-2 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none transition-shadow ${missingGlowClass('initial_severity')}`} />
                  </div>
                  <div>
                    <label className="block text-slate-300 mb-1">Priority</label>
                    <input type="text" name="priority" value={formData.priority} onChange={handleInputChange} className={`w-full bg-slate-950 border rounded-xl px-3 py-2 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none transition-shadow ${missingGlowClass('priority')}`} />
                  </div>
                  <div>
                    <label className="block text-slate-300 mb-1">Risk Assessment</label>
                    <input type="text" name="risk_assessment" value={formData.risk_assessment} onChange={handleInputChange} className={`w-full bg-slate-950 border rounded-xl px-3 py-2 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none transition-shadow ${missingGlowClass('risk_assessment')}`} />
                  </div>
                  <div>
                    <label className="block text-slate-300 mb-1 flex items-center gap-1">
                      <Sparkles className="w-3 h-3 text-indigo-400" /> Next Action
                    </label>
                    <input type="text" name="next_action" value={formData.next_action} onChange={handleInputChange} placeholder="AI-suggested routing will appear here after analysis..." className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none" />
                  </div>
                </div>
              </div>

              <div className="space-y-1.5 pt-3 border-t border-slate-800/60">
                <h3 className="font-bold uppercase tracking-wider text-indigo-400 text-[10px]">5. Complaint Description</h3>
                <textarea
                  name="complaint_description"
                  rows="2"
                  value={formData.complaint_description}
                  onChange={handleInputChange}
                  className={`w-full bg-slate-950 border rounded-xl p-2.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none leading-relaxed transition-shadow ${missingGlowClass('complaint_description')}`}
                  placeholder="Full text description of complaint..."
                />
              </div>

              <div className="space-y-2 pt-3 border-t border-slate-800/60">
                <h3 className="font-bold uppercase tracking-wider text-indigo-400 text-[10px] flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3" /> 6. AI Insights
                </h3>
                <div className="space-y-2">
                  <div>
                    <label className="block text-slate-300 mb-1">Complaint Summary</label>
                    <textarea name="complaint_summary" rows="2" value={formData.complaint_summary} onChange={handleInputChange} placeholder="AI-generated summary will appear here after analysis..." className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none leading-relaxed" />
                  </div>
                  <div>
                    <label className="block text-slate-300 mb-1">Root Cause Recommendation</label>
                    <textarea name="root_cause_recommendation" rows="2" value={formData.root_cause_recommendation} onChange={handleInputChange} placeholder="AI-suggested root cause will appear here after analysis..." className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none leading-relaxed" />
                  </div>
                  <div>
                    <label className="block text-slate-300 mb-1">CAPA Recommendation</label>
                    <textarea name="capa_recommendation" rows="2" value={formData.capa_recommendation} onChange={handleInputChange} placeholder="AI-suggested corrective/preventive action will appear here after analysis..." className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none leading-relaxed" />
                  </div>
                </div>
              </div>

              {/* Duplicate Detection Button */}
              {(duplicateResults !== null || duplicateCheckError) && (
                <div className={`rounded-xl border p-3 space-y-2 text-xs ${
                  duplicateResults && duplicateResults.length > 0
                    ? 'bg-amber-950/30 border-amber-500/40'
                    : 'bg-emerald-950/30 border-emerald-500/30'
                }`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 font-semibold">
                      {duplicateResults && duplicateResults.length > 0
                        ? <ShieldAlert className="w-4 h-4 text-amber-400" />
                        : <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                      <span className={duplicateResults && duplicateResults.length > 0 ? 'text-amber-300' : 'text-emerald-300'}>
                        {duplicateCheckError
                          ? `Error: ${duplicateCheckError}`
                          : duplicateResults && duplicateResults.length > 0
                            ? `${duplicateResults.length} Potential Duplicate(s) Found`
                            : 'No duplicates found — this complaint appears unique.'}
                      </span>
                    </div>
                    <button onClick={() => dispatch(clearDuplicateResults())} className="text-slate-500 hover:text-slate-300 transition">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {duplicateResults && duplicateResults.length > 0 && (
                    <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                      {duplicateResults.map((dup) => (
                        <div key={dup.id} className="bg-slate-900/70 border border-amber-500/20 rounded-lg p-2.5 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="font-mono font-semibold text-amber-300">{dup.complaint_ref_no}</span>
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                              dup.similarity_pct >= 80
                                ? 'bg-rose-500/20 border-rose-400/40 text-rose-300'
                                : dup.similarity_pct >= 60
                                  ? 'bg-amber-500/20 border-amber-400/40 text-amber-300'
                                  : 'bg-yellow-500/10 border-yellow-400/30 text-yellow-300'
                            }`}>
                              {dup.similarity_pct}% match
                            </span>
                          </div>
                          <div className="w-full bg-slate-800 h-1 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                dup.similarity_pct >= 80 ? 'bg-rose-500' : dup.similarity_pct >= 60 ? 'bg-amber-400' : 'bg-yellow-400'
                              }`}
                              style={{ width: `${dup.similarity_pct}%` }}
                            />
                          </div>
                          <div className="text-slate-400 flex gap-3 flex-wrap">
                            <span>{dup.product_name || 'N/A'}</span>
                            <span className="text-slate-600">·</span>
                            <span className="font-mono">{dup.batch_number || 'N/A'}</span>
                            <span className="text-slate-600">·</span>
                            <span>{dup.complaint_date || 'N/A'}</span>
                          </div>
                          {dup.complaint_description_snippet && (
                            <p className="text-slate-500 italic truncate">"{dup.complaint_description_snippet}"</p>
                          )}
                          {dup.ai_verdict !== null && dup.ai_verdict !== undefined && (
                            <div className={`flex items-start gap-1.5 pt-1 border-t border-slate-800/60 ${
                              dup.ai_verdict ? 'text-rose-300' : 'text-emerald-300'
                            }`}>
                              <Sparkles className="w-3 h-3 shrink-0 mt-0.5" />
                              <span>
                                <strong>{dup.ai_verdict ? 'AI: Likely duplicate' : 'AI: Probably not a duplicate'}</strong>
                                {dup.ai_reasoning ? ` — ${dup.ai_reasoning}` : ''}
                              </span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Reset and Save Button */}
              <div className="pt-2 sticky bottom-0 bg-slate-900/95 py-2 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => dispatch(resetForm())}
                  className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-medium py-2.5 px-4 rounded-xl transition-all flex items-center justify-center gap-2 text-xs shadow-sm"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Reset</span>
                </button>

                <button
                  type="submit"
                  disabled={isSaving || isDuplicateChecking || !isExtracted}
                  className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold py-2.5 px-4 rounded-xl transition-all shadow-md shadow-emerald-600/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-xs"
                >
                  {isSaving ? (
                    <><RefreshCw className="w-3.5 h-3.5 animate-spin" /><span>Saving...</span></>
                  ) : isDuplicateChecking ? (
                    <><RefreshCw className="w-3.5 h-3.5 animate-spin" /><span>Checking for duplicates...</span></>
                  ) : (
                    <><Send className="w-3.5 h-3.5" /><span>Save Record</span></>
                  )}
                </button>
              </div>
            </form>
          </section>

          {/* Duplicate Confirmation */}
          {showDuplicateModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in">
              <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-400 shrink-0">
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-100">
                      Potential Duplicate Detected
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      High similarity match found in existing audit logs.
                    </p>
                  </div>
                </div>
                
                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowDuplicateModal(false)}
                    className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium py-2 rounded-xl text-xs transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => executeSave(pendingPayload)}
                    className="flex-1 bg-amber-600 hover:bg-amber-500 text-white font-medium py-2 rounded-xl text-xs transition"
                  >
                    Proceed Anyway
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      ) : (
        /* History View */
        <main className="flex-1 max-w-[1600px] w-full mx-auto p-4 overflow-y-auto">
          <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 backdrop-blur-sm shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-200">Logged Complaints History</h2>
              <button
                onClick={fetchHistory}
                className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-xl text-xs flex items-center gap-1.5 transition"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingHistory ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            </div>

            {historyError && (
              <div className="p-3 bg-rose-950/40 border border-rose-500/40 text-rose-300 rounded-xl text-xs">
                {historyError}
              </div>
            )}

            {isLoadingHistory ? (
              <div className="text-center py-12 text-slate-400 text-xs">Loading history...</div>
            ) : historyList.length === 0 ? (
              <div className="text-center py-12 text-slate-500 text-xs">No complaint history records found.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider text-[10px] border-b border-slate-800">
                    <tr>
                      <th className="p-3">Ref No</th>
                      <th className="p-3">Date</th>
                      <th className="p-3">Customer</th>
                      <th className="p-3">Product</th>
                      <th className="p-3">Batch</th>
                      <th className="p-3">Severity</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {historyList.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-800/40 transition">
                        <td className="p-3 font-mono font-semibold text-indigo-400">{item.complaint_ref_no}</td>
                        <td className="p-3 text-slate-300">{item.complaint_date}</td>
                        <td className="p-3 text-slate-200">{item.customer_name || 'N/A'}</td>
                        <td className="p-3 text-slate-200">{item.product_name || 'N/A'}</td>
                        <td className="p-3 font-mono text-slate-300">{item.batch_number || 'N/A'}</td>
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                            item.initial_severity === 'High' ? 'bg-rose-500/20 border-rose-400/40 text-rose-300' :
                            item.initial_severity === 'Medium' ? 'bg-amber-500/20 border-amber-400/40 text-amber-300' :
                            'bg-emerald-500/20 border-emerald-400/40 text-emerald-300'
                          }`}>
                            {item.initial_severity || 'Medium'}
                          </span>
                        </td>
                        <td className="p-3 text-right">
                          <button
                            onClick={() => handleDeleteComplaint(item.id)}
                            className="text-slate-500 hover:text-rose-400 p-1.5 transition rounded-lg hover:bg-rose-950/30"
                            title="Delete Record"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </main>
      )}
    </div>
  );
}

export default App;