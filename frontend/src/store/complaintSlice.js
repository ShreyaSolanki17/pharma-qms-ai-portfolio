import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { API_BASE_URL } from '../config';

const generateRefNo = () => {
  const year = new Date().getFullYear();
  // ponytail: Date.now() suffix keeps this collision-free without a server-issued sequence
  return `COMP-${year}-${Date.now().toString().slice(-6)}`;
};

const initialFormData = {
  complaint_ref_no: generateRefNo(),
  complaint_source: 'Email',
  customer_name: '',
  product_name: '',
  product_strength: '',
  batch_number: '',
  manufacturing_date: '',
  expiry_date: '',
  affected_quantity: '',
  originating_block: '',
  impacted_npm: '',
  complaint_type: 'Quality issue',
  complaint_date: new Date().toISOString().split('T')[0],
  complaint_description: '',
  initial_severity: 'Medium',
  priority: 'Medium',
  risk_assessment: '',
  complaint_summary: '',
  root_cause_recommendation: '',
  capa_recommendation: '',
  next_action: ''
};

// the LLM returns "Not mentioned"/"Unknown" for fields it can't find - treat those as empty.
// it also occasionally echoes the schema hint itself (e.g. "Low | Medium | High | Critical")
// instead of picking one value - reject anything containing the enum-option separator too.
const PLACEHOLDER_VALUES = new Set(['unknown', 'not mentioned', 'n/a', 'none']);
const isPlaceholderValue = (v) =>
  v === null || v === undefined || v === '' ||
  (typeof v === 'string' && (PLACEHOLDER_VALUES.has(v.trim().toLowerCase()) || v.includes(' | ')));

// fields with a real default (today's date, 'Medium' severity) plus the AI-insight fields,
// which are the LLM's own judgment, not something to ask the user for
const FIELDS_WITH_DEFAULTS = new Set(['complaint_ref_no', 'complaint_summary', 'root_cause_recommendation', 'capa_recommendation', 'next_action']);

// derived from initialFormData so this can't drift out of sync with the actual defaults
const CRITICAL_FIELDS = Object.keys(initialFormData).filter(
  (key) => !FIELDS_WITH_DEFAULTS.has(key) && initialFormData[key] === ''
);

const calculateCompleteness = (formData) => {
  const criticalFields = CRITICAL_FIELDS;

  let filledCount = 0;
  const missingFields = [];

  criticalFields.forEach((key) => {
    const val = formData[key];
    if (val !== null && val !== undefined && String(val).trim() !== '') {
      filledCount++;
    } else {
      missingFields.push(key);
    }
  });

  const percentage = Math.round((filledCount / criticalFields.length) * 100);
  return { percentage, missingFields };
};

export const analyzeComplaintText = createAsyncThunk(
  'complaint/analyzeText',
  async (rawText, { dispatch, rejectWithValue }) => {
    try {
      dispatch(setAnalyzing(true));
      dispatch(setProgress({ progress: 20, stepText: 'Scanning document structure & metadata...' }));

      await new Promise((r) => setTimeout(r, 400));
      dispatch(setProgress({ progress: 55, stepText: 'Extracting batch, quantity, and product identifiers...' }));

      await new Promise((r) => setTimeout(r, 500));
      dispatch(setProgress({ progress: 85, stepText: 'Running AI LLM extraction pipeline...' }));

      const response = await fetch(`${API_BASE_URL}/api/complaints/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_text: rawText })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Failed to extract complaint data.');

      dispatch(setProgress({ progress: 100, stepText: 'Extraction completed successfully!' }));
      await new Promise((r) => setTimeout(r, 450));

      return { rawText, extractedData: data.extracted_data };
    } catch (err) {
      return rejectWithValue(err.message);
    }
  }
);

// only merges the fields the correction message actually mentions, so it can't
// clobber the description or AI-insight fields the way a full re-extraction would
export const updateComplaintFromMessage = createAsyncThunk(
  'complaint/updateFromMessage',
  async (correctionText, { dispatch, getState, rejectWithValue }) => {
    try {
      dispatch(setProgress({ progress: 60, stepText: 'Applying your correction...' }));
      const { formData } = getState().complaint;
      const response = await fetch(`${API_BASE_URL}/api/complaints/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correction_text: correctionText, existing_data: formData })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Failed to update complaint.');

      return { updatedFields: data.updated_fields || {} };
    } catch (err) {
      return rejectWithValue(err.message);
    }
  }
);

export const uploadComplaintDocument = createAsyncThunk(
  'complaint/uploadDocument',
  async (file, { dispatch, rejectWithValue }) => {
    try {
      dispatch(setAnalyzing(true));
      dispatch(addChatMessage({ id: Date.now(), sender: 'user', text: `📎 Uploaded Document: ${file.name}` }));

      dispatch(setProgress({ progress: 20, stepText: 'Scanning document structure & metadata...' }));
      await new Promise((r) => setTimeout(r, 400));
      dispatch(setProgress({ progress: 55, stepText: 'Extracting batch, quantity, and product identifiers...' }));

      await new Promise((r) => setTimeout(r, 500));
      dispatch(setProgress({ progress: 85, stepText: 'Running AI LLM extraction pipeline...' }));

      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`${API_BASE_URL}/api/complaints/upload`, {
        method: 'POST',
        body: formData
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Failed to extract text from document.');

      dispatch(setProgress({ progress: 100, stepText: 'Extraction completed successfully!' }));
      await new Promise((r) => setTimeout(r, 450));

      return { fileName: file.name, rawText: data.raw_text, extractedData: data.extracted_data };
    } catch (err) {
      return rejectWithValue(err.message);
    }
  }
);

export const saveComplaintRecord = createAsyncThunk(
  'complaint/saveRecord',
  async (formData, { rejectWithValue }) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/complaints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Failed to save complaint record.');
      return data;
    } catch (err) {
      return rejectWithValue(err.message);
    }
  }
);

export const checkDuplicates = createAsyncThunk(
  'complaint/checkDuplicates',
  async (payload, { rejectWithValue }) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/complaints/check-duplicates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Duplicate check failed.');
      return data; 
    } catch (err) {
      return rejectWithValue(err.message);
    }
  }
);

const initialCompleteness = calculateCompleteness(initialFormData);

const complaintSlice = createSlice({
  name: 'complaint',
  initialState: {
    formData: initialFormData,
    rawInputText: '',
    chatMessages: [
      {
        id: 1,
        sender: 'ai',
        text: 'Hello! I am your Pharma QMS Assistant. You can paste complaint text or drag & drop a PDF / Word document (.pdf, .docx, .txt) below, and I will extract all fields for your form.'
      }
    ],
    isAnalyzing: false,
    analysisProgress: 0,
    analysisStepText: '',
    isSaving: false,
    notification: null,
    isExtracted: false,
    completenessScore: initialCompleteness.percentage,
    missingFields: initialCompleteness.missingFields,
    isDuplicateChecking: false,
    duplicateResults: null,
    duplicateCheckError: null,
  },
  reducers: {
    setFormField: (state, action) => {
      const { name, value } = action.payload;
      state.formData[name] = value;

      const comp = calculateCompleteness(state.formData);
      state.completenessScore = comp.percentage;
      state.missingFields = comp.missingFields;
    },
    setRawInputText: (state, action) => {
      state.rawInputText = action.payload;
    },
    addChatMessage: (state, action) => {
      state.chatMessages.push(action.payload);
    },
    setAnalyzing: (state, action) => {
      state.isAnalyzing = action.payload;
      if (!action.payload) {
        state.analysisProgress = 0;
        state.analysisStepText = '';
      }
    },
    setProgress: (state, action) => {
      state.analysisProgress = action.payload.progress;
      state.analysisStepText = action.payload.stepText;
    },
    setNotification: (state, action) => {
      state.notification = action.payload;
    },
    clearDuplicateResults: (state) => {
      state.duplicateResults = null;
      state.duplicateCheckError = null;
    },
    resetForm: (state) => {
      state.formData = { ...initialFormData, complaint_ref_no: generateRefNo() };
      state.rawInputText = '';
      state.notification = null;
      state.duplicateResults = null;
      state.duplicateCheckError = null;
      state.isExtracted = false;

      const comp = calculateCompleteness(state.formData);
      state.completenessScore = comp.percentage;
      state.missingFields = comp.missingFields;
    }
  },
  extraReducers: (builder) => {
    builder
     
      .addCase(analyzeComplaintText.fulfilled, (state, action) => {
        state.isAnalyzing = false;
        state.analysisProgress = 0;
        state.analysisStepText = '';
        state.isExtracted = true;

        const { rawText, extractedData } = action.payload;
        const cleaned = Object.fromEntries(
          Object.entries(extractedData || {}).filter(([, v]) => !isPlaceholderValue(v))
        );

        state.formData = {
          ...state.formData,
          ...cleaned,
          affected_quantity: cleaned.affected_quantity
            ? String(cleaned.affected_quantity)
            : state.formData.affected_quantity,
          complaint_description: rawText
        };

        const comp = calculateCompleteness(state.formData);
        state.completenessScore = comp.percentage;
        state.missingFields = comp.missingFields;

        state.duplicateResults = null;
        state.duplicateCheckError = null;

        state.chatMessages.push({
          id: Date.now(),
          sender: 'ai',
          text: `✅ Analysis Complete! Form completeness is at ${comp.percentage}%. Please review any missing details before saving.`
        });
      })
      .addCase(analyzeComplaintText.rejected, (state, action) => {
        state.isAnalyzing = false;
        state.analysisProgress = 0;
        state.analysisStepText = '';
        state.chatMessages.push({
          id: Date.now(),
          sender: 'ai',
          text: `⚠️ Analysis Failed: ${action.payload}`
        });
      })

      .addCase(updateComplaintFromMessage.pending, (state) => {
        state.isAnalyzing = true;
      })
      .addCase(updateComplaintFromMessage.fulfilled, (state, action) => {
        state.isAnalyzing = false;
        state.analysisProgress = 0;
        state.analysisStepText = '';

        const cleaned = Object.fromEntries(
          Object.entries(action.payload.updatedFields || {}).filter(([, v]) => !isPlaceholderValue(v))
        );

        state.formData = {
          ...state.formData,
          ...cleaned,
          affected_quantity: cleaned.affected_quantity
            ? String(cleaned.affected_quantity)
            : state.formData.affected_quantity,
        };

        const comp = calculateCompleteness(state.formData);
        state.completenessScore = comp.percentage;
        state.missingFields = comp.missingFields;
        state.duplicateResults = null;
        state.duplicateCheckError = null;

        const changedFields = Object.keys(cleaned);
        state.chatMessages.push({
          id: Date.now(),
          sender: 'ai',
          text: changedFields.length > 0
            ? `Got it — updated ${changedFields.map((f) => f.replace(/_/g, ' ')).join(', ')}. Everything else stays as is.`
            : "I couldn't find a field to update from that message — could you be more specific?"
        });
      })
      .addCase(updateComplaintFromMessage.rejected, (state, action) => {
        state.isAnalyzing = false;
        state.analysisProgress = 0;
        state.analysisStepText = '';
        state.chatMessages.push({
          id: Date.now(),
          sender: 'ai',
          text: `⚠️ Update Failed: ${action.payload}`
        });
      })

      .addCase(uploadComplaintDocument.fulfilled, (state, action) => {
        state.isAnalyzing = false;
        state.analysisProgress = 0;
        state.analysisStepText = '';
        state.isExtracted = true;

        const { fileName, rawText, extractedData } = action.payload;
        const cleaned = Object.fromEntries(
          Object.entries(extractedData || {}).filter(([, v]) => !isPlaceholderValue(v))
        );

        state.formData = {
          ...state.formData,
          ...cleaned,
          affected_quantity: cleaned.affected_quantity
            ? String(cleaned.affected_quantity)
            : state.formData.affected_quantity,
          complaint_description: rawText || state.formData.complaint_description
        };

        const comp = calculateCompleteness(state.formData);
        state.completenessScore = comp.percentage;
        state.missingFields = comp.missingFields;

        state.duplicateResults = null;
        state.duplicateCheckError = null;

        state.chatMessages.push({
          id: Date.now(),
          sender: 'ai',
          text: `✅ Document '${fileName}' processed successfully! Completeness is at ${comp.percentage}%.`
        });
      })
      .addCase(uploadComplaintDocument.rejected, (state, action) => {
        state.isAnalyzing = false;
        state.analysisProgress = 0;
        state.analysisStepText = '';
        state.chatMessages.push({
          id: Date.now(),
          sender: 'ai',
          text: `⚠️ Document Processing Failed: ${action.payload}`
        });
      })

      .addCase(saveComplaintRecord.pending, (state) => {
        state.isSaving = true;
        state.notification = null;
      })
      .addCase(saveComplaintRecord.fulfilled, (state) => {
        state.isSaving = false;
        state.notification = {
          type: 'success',
          text: `Complaint '${state.formData.complaint_ref_no}' successfully saved to database!`
        };
        state.formData = { ...initialFormData, complaint_ref_no: generateRefNo() };
        state.rawInputText = '';
        state.duplicateResults = null;
        state.duplicateCheckError = null;
        state.isExtracted = false;

        const comp = calculateCompleteness(state.formData);
        state.completenessScore = comp.percentage;
        state.missingFields = comp.missingFields;
      })
      .addCase(saveComplaintRecord.rejected, (state, action) => {
        state.isSaving = false;
        state.notification = {
          type: 'error',
          text: action.payload || 'Failed to save complaint record.'
        };
      })

      .addCase(checkDuplicates.pending, (state) => {
        state.isDuplicateChecking = true;
        state.duplicateCheckError = null;
      })
      .addCase(checkDuplicates.fulfilled, (state, action) => {
        state.isDuplicateChecking = false;
        state.duplicateResults = action.payload.matches;
      })
      .addCase(checkDuplicates.rejected, (state, action) => {
        state.isDuplicateChecking = false;
        state.duplicateCheckError = action.payload || 'Duplicate check failed.';
        state.duplicateResults = [];
      });
  }
});

export const {
  setFormField,
  setRawInputText,
  addChatMessage,
  setAnalyzing,
  setProgress,
  setNotification,
  clearDuplicateResults,
  resetForm
} = complaintSlice.actions;

export default complaintSlice.reducer;