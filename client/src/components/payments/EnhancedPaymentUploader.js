import React, { useState } from 'react';
import toast from 'react-hot-toast';

const EnhancedPaymentUploader = ({ token, onUploadComplete }) => {
  const [step, setStep] = useState('upload'); // 'upload', 'mapping', 'processing', 'complete'
  const [selectedFile, setSelectedFile] = useState(null);
  const [analysisData, setAnalysisData] = useState(null);
  const [columnMapping, setColumnMapping] = useState({});
  const [saveMappingAs, setSaveMappingAs] = useState('');
  const [bankName, setBankName] = useState('');
  const [savedMappings, setSavedMappings] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [uploadResults, setUploadResults] = useState(null);

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      const ext = file.name.toLowerCase().split('.').pop();
      const isCSV = file.type === 'text/csv' || ext === 'csv';
      const isPDF = file.type === 'application/pdf' || ext === 'pdf';
      
      if (isCSV || isPDF) {
        setSelectedFile(file);
        setStep('upload');
      } else {
        toast.error('Please select a CSV or PDF file');
      }
    }
  };

  const handleUploadAndAnalyze = async () => {
    if (!selectedFile) {
      toast.error('Please select a CSV or PDF file');
      return;
    }

    try {
      setProcessing(true);
      const formData = new FormData();
      formData.append('bankStatement', selectedFile);

      const response = await fetch('/api/enhanced-invoices/upload-and-analyze', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });

      const data = await response.json();

      if (data.success) {
        setAnalysisData(data);
        setSavedMappings(data.savedMappings || []);
        
        const isPDF = data.analysis.fileType === 'PDF' || data.file.fileType === 'PDF';
        
        // If confidence is high or PDF (auto-parsed), use auto-detected mapping
        if (!data.analysis.needsManualMapping || isPDF) {
          setColumnMapping(data.analysis.autoDetectedMapping);
          if (isPDF) {
            toast.success(`PDF parsed: Found ${data.analysis.totalRows} transactions (${data.analysis.transactionsWithStudentIds || 0} with student IDs)`);
          } else {
            toast.success(`Columns auto-detected with ${data.analysis.confidence}% confidence`);
          }
        } else {
          // Initialize with auto-detected mapping for manual adjustment
          setColumnMapping(data.analysis.autoDetectedMapping);
          toast(`Auto-detection confidence: ${data.analysis.confidence}%. Please verify column mapping.`, {
            icon: '⚠️',
            duration: 4000,
          });
        }
        
        setStep('mapping');
      } else {
        throw new Error(data.message || 'Upload failed');
      }
    } catch (error) {
      console.error('Upload error:', error);
      toast.error('Failed to analyze file: ' + error.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleUseSavedMapping = (mapping) => {
    setColumnMapping({
      reference: mapping.reference_column,
      amount: mapping.amount_column,
      date: mapping.date_column,
      description: mapping.description_column,
      debit: mapping.debit_column,
      credit: mapping.credit_column
    });
    setSaveMappingAs(mapping.mapping_name);
    setBankName(mapping.bank_name || '');
    toast.success(`Applied mapping: ${mapping.mapping_name}`);
  };

  const handleProcessWithMapping = async () => {
    if (!analysisData?.file?.filename) {
      toast.error('No file to process');
      return;
    }

    const isPDF = analysisData.analysis?.fileType === 'PDF' || analysisData.file?.fileType === 'PDF';
    
    // Validate mapping (skip for PDF as it's auto-parsed)
    if (!isPDF) {
      const requiredFields = ['reference', 'date'];
      const hasAmountOrDebitCredit = columnMapping.amount || (columnMapping.debit && columnMapping.credit);
      
      if (!hasAmountOrDebitCredit || !requiredFields.every(field => columnMapping[field])) {
        toast.error('Please map at least Reference, Date, and Amount (or Debit/Credit) columns');
        return;
      }
    }

    try {
      setProcessing(true);
      setStep('processing');

      const response = await fetch('/api/enhanced-invoices/process-with-mapping', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          filename: analysisData.file.filename,
          mapping: columnMapping,
          saveMappingAs: isPDF ? undefined : (saveMappingAs.trim() || undefined),
          bankName: isPDF ? 'FNB' : (bankName.trim() || undefined),
          fileType: isPDF ? 'PDF' : 'CSV'
        })
      });

      const data = await response.json();

      if (data.success) {
        setUploadResults(data);
        setStep('complete');
        toast.success(`Successfully processed ${data.summary.totalProcessed} transactions from ${isPDF ? 'PDF' : 'CSV'}`);
        
        if (onUploadComplete) {
          onUploadComplete(data);
        }
      } else {
        throw new Error(data.message || 'Processing failed');
      }
    } catch (error) {
      console.error('Processing error:', error);
      toast.error('Failed to process file: ' + error.message);
      setStep('mapping'); // Go back to mapping step
    } finally {
      setProcessing(false);
    }
  };

  const handleColumnChange = (field, value) => {
    setColumnMapping(prev => ({
      ...prev,
      [field]: value || undefined
    }));
  };

  const handleReset = () => {
    setStep('upload');
    setSelectedFile(null);
    setAnalysisData(null);
    setColumnMapping({});
    setSaveMappingAs('');
    setBankName('');
    setUploadResults(null);
  };

  const renderUploadStep = () => (
    <div className="space-y-4">
      <h3 className="text-lg font-medium">Upload Bank Statement</h3>
      
      <div className="border-2 border-dashed border-gray-300 rounded-lg p-6">
        <div className="text-center">
          <input
            type="file"
            accept=".csv,.pdf"
            onChange={handleFileSelect}
            className="hidden"
            id="bank-statement-file"
          />
          <label
            htmlFor="bank-statement-file"
            className="cursor-pointer flex flex-col items-center"
          >
            <svg className="w-12 h-12 text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="text-lg font-medium text-gray-900">
              {selectedFile ? selectedFile.name : 'Choose CSV or PDF file'}
            </p>
            <p className="text-sm text-gray-500">
              Bank statement in CSV or PDF format (max 20MB)
            </p>
            <p className="text-xs text-gray-400 mt-1">
              FNB PDF statements are auto-parsed
            </p>
          </label>
        </div>
      </div>

      {selectedFile && (
        <div className="bg-green-50 p-4 rounded-lg">
          <div className="flex items-center">
            <svg className="w-5 h-5 text-green-400 mr-2" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <p className="text-sm text-green-700">
              File selected: {selectedFile.name} ({Math.round(selectedFile.size / 1024)} KB)
            </p>
          </div>
        </div>
      )}

      <button
        onClick={handleUploadAndAnalyze}
        disabled={!selectedFile || processing}
        className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {processing ? 'Analyzing...' : 'Analyze File'}
      </button>
    </div>
  );

  const renderMappingStep = () => {
    const isPDF = analysisData.analysis?.fileType === 'PDF' || analysisData.file?.fileType === 'PDF';
    
    if (isPDF) {
      return (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium">PDF Bank Statement Parsed</h3>
            <span className="px-3 py-1 bg-green-100 text-green-800 text-sm rounded-full">
              FNB Format
            </span>
          </div>

          <div className="bg-green-50 p-4 rounded-lg border border-green-200">
            <div className="flex items-center">
              <svg className="w-5 h-5 text-green-400 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <p className="text-sm text-green-700">
                PDF parsed successfully. Found {analysisData.analysis.totalRows} transactions
                {analysisData.analysis.transactionsWithStudentIds > 0 && 
                  ` (${analysisData.analysis.transactionsWithStudentIds} with student IDs)`}.
              </p>
            </div>
          </div>

          {/* Sample Transactions Preview */}
          {analysisData.analysis.sampleRows && analysisData.analysis.sampleRows.length > 0 && (
            <div className="bg-gray-50 p-4 rounded-lg">
              <h4 className="text-sm font-medium text-gray-900 mb-3">Sample Transactions</h4>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="p-2 text-left font-medium">Date</th>
                      <th className="p-2 text-left font-medium">Description</th>
                      <th className="p-2 text-right font-medium">Amount</th>
                      <th className="p-2 text-left font-medium">Reference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysisData.analysis.sampleRows.map((row, index) => (
                      <tr key={index} className="border-b">
                        <td className="p-2 text-gray-600">{row.date}</td>
                        <td className="p-2 text-gray-600">{row.description}</td>
                        <td className="p-2 text-gray-600 text-right">R {row.amount?.toFixed(2)}</td>
                        <td className="p-2 text-gray-600">{row.reference}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex gap-4">
            <button
              onClick={handleReset}
              className="flex-1 border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50"
            >
              Upload Different File
            </button>
            <button
              onClick={handleProcessWithMapping}
              disabled={processing}
              className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {processing ? 'Processing...' : 'Process Payments'}
            </button>
          </div>
        </div>
      );
    }
    
    return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Map CSV Columns</h3>
        <div className="text-sm text-gray-500">
          Confidence: {analysisData.analysis.confidence}%
        </div>
      </div>

      {analysisData.analysis.confidence < 80 && (
        <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
          <div className="flex items-center">
            <svg className="w-5 h-5 text-yellow-400 mr-2" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <p className="text-sm text-yellow-700">
              Please verify the column mappings below as auto-detection confidence is low.
            </p>
          </div>
        </div>
      )}

      {/* Saved Mappings */}
      {savedMappings.length > 0 && (
        <div className="bg-gray-50 p-4 rounded-lg">
          <h4 className="text-sm font-medium text-gray-900 mb-3">Use Saved Mapping</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {savedMappings.map((mapping) => (
              <button
                key={mapping.id}
                onClick={() => handleUseSavedMapping(mapping)}
                className="text-left p-3 bg-white border border-gray-200 rounded-lg hover:border-blue-300 transition-colors"
              >
                <div className="font-medium text-sm">{mapping.mapping_name}</div>
                {mapping.bank_name && (
                  <div className="text-xs text-gray-500">{mapping.bank_name}</div>
                )}
                <div className="text-xs text-gray-400 mt-1">
                  Used {mapping.use_count} times
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Sample Data Preview */}
      <div className="bg-gray-50 p-4 rounded-lg">
        <h4 className="text-sm font-medium text-gray-900 mb-3">Sample Data</h4>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-100">
                {analysisData.analysis.headers.map((header, index) => (
                  <th key={index} className="p-2 text-left font-medium">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {analysisData.analysis.sampleRows.slice(0, 3).map((row, rowIndex) => (
                <tr key={rowIndex} className="border-b">
                  {analysisData.analysis.headers.map((header, colIndex) => (
                    <td key={colIndex} className="p-2 text-gray-600">
                      {row[header]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Column Mapping */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Reference Column *
          </label>
          <select
            value={columnMapping.reference || ''}
            onChange={(e) => handleColumnChange('reference', e.target.value)}
            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">Select column...</option>
            {analysisData.analysis.headers.map((header) => (
              <option key={header} value={header}>{header}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Date Column *
          </label>
          <select
            value={columnMapping.date || ''}
            onChange={(e) => handleColumnChange('date', e.target.value)}
            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">Select column...</option>
            {analysisData.analysis.headers.map((header) => (
              <option key={header} value={header}>{header}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Amount Column
          </label>
          <select
            value={columnMapping.amount || ''}
            onChange={(e) => handleColumnChange('amount', e.target.value)}
            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            disabled={columnMapping.debit && columnMapping.credit}
          >
            <option value="">Select column...</option>
            {analysisData.analysis.headers.map((header) => (
              <option key={header} value={header}>{header}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Description Column
          </label>
          <select
            value={columnMapping.description || ''}
            onChange={(e) => handleColumnChange('description', e.target.value)}
            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">Select column...</option>
            {analysisData.analysis.headers.map((header) => (
              <option key={header} value={header}>{header}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Debit Column (Optional)
          </label>
          <select
            value={columnMapping.debit || ''}
            onChange={(e) => handleColumnChange('debit', e.target.value)}
            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">Select column...</option>
            {analysisData.analysis.headers.map((header) => (
              <option key={header} value={header}>{header}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Credit Column (Optional)
          </label>
          <select
            value={columnMapping.credit || ''}
            onChange={(e) => handleColumnChange('credit', e.target.value)}
            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">Select column...</option>
            {analysisData.analysis.headers.map((header) => (
              <option key={header} value={header}>{header}</option>
            ))}
          </select>
        </div>
      </div>

      {(columnMapping.debit || columnMapping.credit) && (
        <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
          <p className="text-sm text-blue-700">
            <strong>Note:</strong> When using separate Debit/Credit columns, credit amounts (payments received) will be processed.
          </p>
        </div>
      )}

      {/* Save Mapping Options */}
      <div className="bg-gray-50 p-4 rounded-lg">
        <h4 className="text-sm font-medium text-gray-900 mb-3">Save This Mapping (Optional)</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Mapping Name
            </label>
            <input
              type="text"
              value={saveMappingAs}
              onChange={(e) => setSaveMappingAs(e.target.value)}
              placeholder="e.g., Standard Bank Format"
              className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Bank Name (Optional)
            </label>
            <input
              type="text"
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              placeholder="e.g., Standard Bank"
              className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex space-x-4">
        <button
          onClick={handleReset}
          className="flex-1 bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700"
        >
          Back to Upload
        </button>
        <button
          onClick={handleProcessWithMapping}
          disabled={processing || !(columnMapping.reference && columnMapping.date && (columnMapping.amount || (columnMapping.debit && columnMapping.credit)))}
          className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {processing ? 'Processing...' : 'Process Transactions'}
        </button>
      </div>
    </div>
  );
  };

  const renderProcessingStep = () => (
    <div className="text-center py-8">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
      <h3 className="text-lg font-medium text-gray-900 mb-2">Processing Transactions</h3>
      <p className="text-gray-600">
        Please wait while we process your bank statement...
      </p>
    </div>
  );

  const renderCompleteStep = () => (
    <div className="space-y-6">
      <div className="text-center">
        <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">Processing Complete!</h3>
        <p className="text-gray-600">
          Successfully processed {uploadResults?.summary?.totalProcessed} transactions
        </p>
      </div>

      {/* Results Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-green-50 p-4 rounded-lg text-center">
          <div className="text-2xl font-bold text-green-600">
            {uploadResults?.summary?.matched || 0}
          </div>
          <div className="text-sm text-green-700">Matched</div>
        </div>
        <div className="bg-yellow-50 p-4 rounded-lg text-center">
          <div className="text-2xl font-bold text-yellow-600">
            {uploadResults?.summary?.partial || 0}
          </div>
          <div className="text-sm text-yellow-700">Partial</div>
        </div>
        <div className="bg-blue-50 p-4 rounded-lg text-center">
          <div className="text-2xl font-bold text-blue-600">
            {uploadResults?.summary?.overpaid || 0}
          </div>
          <div className="text-sm text-blue-700">Overpaid</div>
        </div>
        <div className="bg-red-50 p-4 rounded-lg text-center">
          <div className="text-2xl font-bold text-red-600">
            {uploadResults?.summary?.unmatched || 0}
          </div>
          <div className="text-sm text-red-700">Unmatched</div>
        </div>
      </div>

      {uploadResults?.summary?.errors > 0 && (
        <div className="bg-red-50 p-4 rounded-lg border border-red-200">
          <h4 className="text-sm font-medium text-red-800 mb-2">
            {uploadResults.summary.errors} Error(s) Encountered
          </h4>
          <div className="text-sm text-red-700">
            Some transactions could not be processed. Please check the transaction logs.
          </div>
        </div>
      )}

      <button
        onClick={handleReset}
        className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
      >
        Upload Another File
      </button>
    </div>
  );

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      {step === 'upload' && renderUploadStep()}
      {step === 'mapping' && renderMappingStep()}
      {step === 'processing' && renderProcessingStep()}
      {step === 'complete' && renderCompleteStep()}
    </div>
  );
};

export default EnhancedPaymentUploader;
