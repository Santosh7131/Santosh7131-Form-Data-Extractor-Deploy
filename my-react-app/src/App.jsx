import React, { useRef, useState, useEffect, useMemo } from "react";
import { Upload, FileText, Users, CheckCircle, Database, Sparkles } from "lucide-react";
import { MaterialReactTable, useMaterialReactTable } from "material-react-table";
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField } from '@mui/material';

// API URL from environment variable
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

function App() {
  const fileInputRef = useRef();
  const [documents, setDocuments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [editingCell, setEditingCell] = useState({ row: null, col: null });
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  // State for editing nested objects
  const [editModal, setEditModal] = useState({ open: false, rowIdx: null, col: null, value: null });

  // Fetch documents from backend
  const fetchDocuments = async () => {
    try {
      setError("");
      const res = await fetch(`${API_URL}/api/all-documents`);
      const data = await res.json();
      setDocuments(data.data || []);
    } catch (err) {
      setError("Failed to fetch documents: " + err.message);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, []);

  const handleUploadClick = () => fileInputRef.current.click();

  const handleFileChange = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    setUploading(true);
    setFeedback("");
    setError("");

    // Separate files by type
    const pdfFiles = files.filter(file => file.type === "application/pdf");
    const imageFiles = files.filter(file => file.type !== "application/pdf");

    let feedbackMsg = "";
    try {
      // Upload PDFs in batch if any
      if (pdfFiles.length) {
        const formData = new FormData();
        pdfFiles.forEach(file => formData.append("files", file));
        const res = await fetch(`${API_URL}/api/upload-scanned-pdfs`, {
          method: "POST",
          body: formData,
        });
        const result = await res.json();
        if (result.data) {
          setDocuments(result.data);
          feedbackMsg += "PDF documents uploaded and extracted successfully! ";
        } else {
          setError("PDF upload failed: " + (result.error || "Unknown error"));
        }
      }
      // Upload images in batch if any
      if (imageFiles.length) {
        const formData = new FormData();
        imageFiles.forEach(file => formData.append("files", file));
        const res = await fetch(`${API_URL}/api/upload-images`, {
          method: "POST",
          body: formData,
        });
        const result = await res.json();
        if (result.data) {
          setDocuments(result.data);
          feedbackMsg += "Images uploaded and extracted successfully!";
        } else {
          setError("Image upload failed: " + (result.error || "Unknown error"));
        }
      }
      setFeedback(feedbackMsg.trim());
    } catch (err) {
      setError("Upload failed: " + err.message);
    }
    setUploading(false);
    e.target.value = null;
  };

  // Recursive SubTable component for nested JSON rendering (robust to stringified JSON)
  const SubTable = ({ data }) => {
    console.log('SubTable data:', data); // Debug: log incoming data
    // Try to parse stringified JSON
    let parsed = data;
    if (typeof data === 'string') {
      try {
        const tryParsed = JSON.parse(data);
        if (typeof tryParsed === 'object' && tryParsed !== null) {
          parsed = tryParsed;
        } else {
          return <span>{String(data)}</span>;
        }
      } catch {
        // Try to fix single quotes to double quotes and parse again
        try {
          const tryParsed = JSON.parse(data.replace(/'/g, '"'));
          if (typeof tryParsed === 'object' && tryParsed !== null) {
            parsed = tryParsed;
          } else {
            return <span>{String(data)}</span>;
          }
        } catch {
          return <span>{String(data)}</span>;
        }
      }
    }
    if (!parsed || typeof parsed !== 'object') return <span>{String(parsed)}</span>;
    const entries = Array.isArray(parsed)
      ? parsed.map((v, i) => [i, v])
      : Object.entries(parsed);
    return (
      <div style={{
        background: '#f8fafc',
        borderRadius: 10,
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
        padding: 8,
        margin: 0,
        width: '100%',
        minWidth: 0,
        minHeight: 60,
        boxSizing: 'border-box',
        display: 'block',
      }}>
        <table style={{ fontSize: '0.98em', borderCollapse: 'collapse', width: '100%' }}>
          <tbody>
            {entries.map(([key, value]) => (
              <tr key={key}>
                <td style={{ border: '1px solid #e2e8f0', padding: '6px 10px', fontWeight: 600, background: '#f1f5f9', color: '#334155', minWidth: 90 }}>{key}</td>
                <td style={{ border: '1px solid #e2e8f0', padding: '6px 10px', background: '#fff' }}>
                  {/* Recursively render nested objects, arrays, or stringified JSON */}
                  {typeof value === 'object' && value !== null
                    ? <SubTable data={value} />
                    : typeof value === 'string'
                      ? <SubTable data={value} />
                      : String(value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  // Helper to recursively render editable fields for an object
  const renderEditFields = (obj, path = []) => {
    return Object.entries(obj).map(([key, value]) => {
      const fieldPath = [...path, key];
      if (typeof value === 'object' && value !== null) {
        return (
          <div key={fieldPath.join('.')} style={{ marginLeft: 12, marginBottom: 16, padding: 8, background: '#f5f7fa', borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
            <div style={{ fontWeight: 600, marginBottom: 6, color: '#374151' }}>{key}</div>
            <div style={{ marginLeft: 8 }}>
              {renderEditFields(value, fieldPath)}
            </div>
          </div>
        );
      }
      return (
        <TextField
          key={fieldPath.join('.')}
          label={key}
          value={value ?? ''}
          size="small"
          margin="dense"
          fullWidth
          sx={{ marginBottom: 2 }}
          onChange={e => {
            // Update nested value in editModal.value
            const newValue = e.target.value;
            setEditModal(prev => {
              const updated = { ...prev.value };
              let ref = updated;
              for (let i = 0; i < fieldPath.length - 1; i++) {
                ref[fieldPath[i]] = { ...ref[fieldPath[i]] };
                ref = ref[fieldPath[i]];
              }
              ref[fieldPath[fieldPath.length - 1]] = newValue;
              return { ...prev, value: updated };
            });
          }}
        />
      );
    });
  };

  // Save handler for modal
  const handleModalSave = () => {
    if (editModal.rowIdx !== null && editModal.col) {
      setDocuments(prevDocs => {
        const updated = [...prevDocs];
        updated[editModal.rowIdx] = {
          ...updated[editModal.rowIdx],
          [editModal.col]: editModal.value
        };
        return updated;
      });
    }
    setEditModal({ open: false, rowIdx: null, col: null, value: null });
  };

  // Cancel handler for modal
  const handleModalCancel = () => {
    setEditModal({ open: false, rowIdx: null, col: null, value: null });
  };

  // Define MRT columns dynamically, using SubTable for objects/arrays or stringified JSON
  const columns = useMemo(() =>
    documents.length > 0
      ? Object.keys(documents[0]).map((key) => ({
          accessorKey: key,
          header: key,
          enableEditing: true,
          Cell: ({ cell, row }) => {
            let value = cell.getValue();
            // If value is a string and looks like JSON, try to parse and render as SubTable
            if (typeof value === 'string' && (value.trim().startsWith('{') || value.trim().startsWith('['))) {
              try {
                const parsed = JSON.parse(value);
                if (typeof parsed === 'object' && parsed !== null) {
                  value = parsed;
                }
              } catch {
                try {
                  const parsed = JSON.parse(value.replace(/'/g, '"'));
                  if (typeof parsed === 'object' && parsed !== null) {
                    value = parsed;
                  }
                } catch {}
              }
            }
            if (typeof value === 'object' && value !== null) {
              return (
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 80 }}>
                  <div style={{ flex: 1, width: '100%' }}>
                    <SubTable data={value} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12, marginBottom: 2 }}>
                    <Button
                      variant="outlined"
                      size="small"
                      onClick={() => setEditModal({ open: true, rowIdx: row.index, col: key, value: value })}
                    >
                      Edit
                    </Button>
                  </div>
                </div>
              );
            }
            return <span>{String(value)}</span>;
          },
          // Only allow default editing for primitives
          enableEditing: row => {
            const value = row.original[key];
            return typeof value !== 'object';
          }
        }))
      : [],
    [documents]
  );

  // MRT editing handlers
  const handleSaveCell = async ({ row, column, value }) => {
    const updatedDocs = [...documents];
    updatedDocs[row.index] = { ...updatedDocs[row.index], [column.id]: value };
    setDocuments(updatedDocs);
  };

  const table = useMaterialReactTable({
    columns,
    data: documents,
    enableEditing: true,
    editDisplayMode: 'cell',
    muiTableContainerProps: { sx: { maxHeight: 500, fontFamily: styles.container.fontFamily } },
    muiTableBodyCellProps: { sx: { fontFamily: styles.container.fontFamily, backgroundColor: 'white', '&:hover': { backgroundColor: 'white' }, '&.Mui-hover': { backgroundColor: 'white' } } },
    muiTableHeadCellProps: { sx: { fontFamily: styles.container.fontFamily } },
    muiTableBodyRowProps: { sx: { backgroundColor: 'white', '&:hover': { backgroundColor: 'white' }, '&.Mui-hover': { backgroundColor: 'white' } } },
    onEditingCellSave: handleSaveCell,
    state: {
      isLoading: uploading,
    },
  });

  // Save verified data to after_verify DB
  const handleSaveVerified = async () => {
    setSaving(true);
    setFeedback("");
    setError("");
    try {
      const res = await fetch(`${API_URL}/api/save-verified`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: documents })
      });
      const result = await res.json();
      if (res.ok) {
        setFeedback("Verified data saved to permanent database!");
      } else {
        setError(result.error || "Failed to save verified data");
      }
    } catch (err) {
      setError("Failed to save verified data: " + err.message);
    }
    setSaving(false);
  };

  return (
    <div style={styles.container}>
      {/* Background Pattern */}
      <div style={styles.backgroundPattern}></div>
      <div style={styles.content}>
        {/* Header Section */}
        <div style={styles.header}>
          <div style={styles.headerIcon}>
            <div style={styles.iconWrapper}>
              <Sparkles style={styles.icon} />
            </div>
          </div>
          <h1 style={styles.title}>
            Document Data Extractor
          </h1>
          <p style={styles.subtitle}>
            Transform your documents into structured data with AI-powered extraction technology
          </p>
        </div>
        {/* Upload Section */}
        <div style={styles.uploadSection}>
          <div 
            style={{
              ...styles.uploadCard,
              ...(uploading ? styles.uploadCardUploading : {})
            }}
            onClick={handleUploadClick}
            tabIndex={0}
          >
            <div style={styles.uploadCardBackground}></div>
            <div style={styles.uploadContent}>
              <input
                type="file"
                ref={fileInputRef}
                style={{ display: "none" }}
                onChange={handleFileChange}
                accept=".pdf,.jpg,.jpeg,.png"
                multiple
              />
              <div style={{
                ...styles.uploadIcon,
                ...(uploading ? styles.uploadIconUploading : {})
              }}>
                {uploading ? (
                  <div style={styles.spinner}></div>
                ) : (
                  <Upload style={styles.uploadIconSvg} />
                )}
              </div>
              <div style={styles.uploadText}>
                {uploading ? (
                  <div style={styles.uploadingText}>
                    <div style={styles.uploadingTitle}>Processing your document...</div>
                    <div style={styles.uploadingSubtitle}>AI is extracting key information</div>
                  </div>
                ) : (
                  <div style={styles.uploadIdleText}>
                    <div style={styles.uploadTitle}>
                      Drop your document(s) here or click to browse
                    </div>
                    <div style={styles.uploadSubtitle}>
                      Supports only PDF and image files (JPG, JPEG, PNG) • Maximum 10MB each
                    </div>
                  </div>
                )}
              </div>
              {/* Supported formats */}
              <div style={styles.formatTags}>
                {['PDF', 'JPG', 'JPEG', 'PNG'].map((format) => (
                  <span key={format} style={styles.formatTag}>
                    {format}
                  </span>
                ))}
              </div>
              <div style={{ marginTop: '1rem', color: '#64748b', fontSize: '0.95rem', textAlign: 'center' }}>
                For best results, use PDF files whenever possible.
              </div>
            </div>
          </div>
        </div>
        {/* Success/Error Feedback */}
        {feedback && (
          <div style={styles.feedbackContainer}>
            <div style={styles.feedbackCard}>
              <CheckCircle style={styles.feedbackIcon} />
              <span style={styles.feedbackText}>{feedback}</span>
            </div>
          </div>
        )}
        {error && (
          <div style={{...styles.feedbackContainer, color: 'red'}}>
            <div style={{...styles.feedbackCard, backgroundColor: '#fee2e2', border: '1px solid #fecaca', color: '#991b1b'}}>
              <span style={styles.feedbackText}>{error}</span>
            </div>
          </div>
        )}
        {/* Documents Table */}
        <div style={styles.tableContainer}>
          <div style={styles.tableHeader}>
            <div style={styles.tableHeaderContent}>
              <div style={styles.tableHeaderIcon}>
                <Database style={styles.tableHeaderIconSvg} />
              </div>
              <div>
                <h2 style={styles.tableTitle}>Extracted Documents</h2>
                <p style={styles.tableSubtitle}>All processed documents and their extracted data</p>
              </div>
            </div>
          </div>
          <div style={styles.tableWrapper}>
            <MaterialReactTable table={table} />
          </div>
        </div>
        {/* Edit Modal for nested objects */}
        <Dialog open={editModal.open} onClose={handleModalCancel} maxWidth="sm" fullWidth>
          <DialogTitle sx={{ fontWeight: 700, color: '#1e293b', background: '#f1f5f9' }}>
            {editModal.col
              ? editModal.col.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
              : 'Edit Nested Fields'}
          </DialogTitle>
          <DialogContent sx={{ padding: 3, background: '#f8fafc' }}>
            {editModal.value && typeof editModal.value === 'object' ? renderEditFields(editModal.value) : null}
          </DialogContent>
          <DialogActions sx={{ background: '#f1f5f9' }}>
            <Button onClick={handleModalCancel} variant="outlined">Cancel</Button>
            <Button onClick={handleModalSave} variant="contained">Save</Button>
          </DialogActions>
        </Dialog>
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: '2rem' }}>
          <button
            onClick={handleSaveVerified}
            disabled={saving || documents.length === 0}
            style={{
              background: saving ? '#a5b4fc' : '#6366f1',
              color: 'white',
              padding: '0.75rem 2rem',
              border: 'none',
              borderRadius: '8px',
              fontSize: '1.1rem',
              fontWeight: 600,
              cursor: saving ? 'not-allowed' : 'pointer',
              boxShadow: '0 2px 8px rgba(99,102,241,0.08)'
            }}
          >
            {saving ? 'Saving...' : 'Save Verified Data'}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #f8fafc 0%, #e0f2fe 50%, #e8eaf6 100%)',
    position: 'relative',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
  },
  backgroundPattern: {
    position: 'absolute',
    inset: 0,
    backgroundImage: 'linear-gradient(rgba(0,0,0,.02) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,.02) 1px, transparent 1px)',
    backgroundSize: '20px 20px',
    zIndex: 1
  },
  content: {
    position: 'relative',
    zIndex: 10,
    maxWidth: '75vw',
    width: '75vw',
    margin: '0 auto',
    padding: '2rem 2rem'
  },
  header: {
    textAlign: 'center',
    marginBottom: '3rem'
  },
  headerIcon: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: '1.5rem',
    position: 'relative'
  },
  iconWrapper: {
    width: '64px',
    height: '64px',
    background: 'linear-gradient(135deg, #2563eb, #4f46e5)',
    borderRadius: '16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 10px 25px rgba(37, 99, 235, 0.3)'
  },
  icon: {
    width: '32px',
    height: '32px',
    color: 'white'
  },
  title: {
    fontSize: '3rem',
    fontWeight: 'bold',
    background: 'linear-gradient(135deg, #2563eb, #4f46e5, #7c3aed)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    marginBottom: '1rem',
    lineHeight: 1.2
  },
  subtitle: {
    fontSize: '1.25rem',
    color: '#64748b',
    maxWidth: '600px',
    margin: '0 auto',
    lineHeight: 1.6
  },
  uploadSection: {
    marginBottom: '3rem'
  },
  uploadCard: {
    position: 'relative',
    backgroundColor: 'white',
    borderRadius: '24px',
    border: '2px dashed #cbd5e1',
    cursor: 'pointer',
    overflow: 'hidden',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
    transition: 'all 0.3s ease',
    ':hover': {
      borderColor: '#3b82f6',
      boxShadow: '0 10px 25px rgba(0, 0, 0, 0.1)'
    }
  },
  uploadCardUploading: {
    borderColor: '#3b82f6',
    backgroundColor: '#eff6ff'
  },
  uploadCardBackground: {
    position: 'absolute',
    inset: 0,
    background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.02), rgba(79, 70, 229, 0.02))',
    opacity: 0,
    transition: 'opacity 0.3s ease'
  },
  uploadContent: {
    position: 'relative',
    zIndex: 10,
    padding: '3rem',
    textAlign: 'center'
  },
  uploadIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '96px',
    height: '96px',
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #dbeafe, #e0e7ff)',
    marginBottom: '1.5rem',
    transition: 'transform 0.3s ease'
  },
  uploadIconUploading: {
    backgroundColor: '#dbeafe',
    animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite'
  },
  uploadIconSvg: {
    width: '40px',
    height: '40px',
    color: '#2563eb'
  },
  spinner: {
    width: '32px',
    height: '32px',
    border: '3px solid #2563eb',
    borderTop: '3px solid transparent',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite'
  },
  uploadText: {
    marginBottom: '2rem'
  },
  uploadingText: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem'
  },
  uploadingTitle: {
    fontSize: '1.25rem',
    fontWeight: '600',
    color: '#2563eb'
  },
  uploadingSubtitle: {
    color: '#64748b'
  },
  uploadIdleText: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem'
  },
  uploadTitle: {
    fontSize: '1.25rem',
    fontWeight: '600',
    color: '#334155'
  },
  uploadSubtitle: {
    color: '#64748b'
  },
  formatTags: {
    display: 'flex',
    justifyContent: 'center',
    gap: '0.75rem',
    flexWrap: 'wrap'
  },
  formatTag: {
    padding: '0.25rem 0.75rem',
    backgroundColor: '#f1f5f9',
    color: '#64748b',
    borderRadius: '20px',
    fontSize: '0.875rem',
    fontWeight: '500'
  },
  feedbackContainer: {
    marginBottom: '2rem',
    display: 'flex',
    justifyContent: 'center'
  },
  feedbackCard: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.75rem',
    backgroundColor: '#ecfdf5',
    border: '1px solid #bbf7d0',
    color: '#166534',
    padding: '1rem 1.5rem',
    borderRadius: '16px',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
    animation: 'fadeIn 0.5s ease-out'
  },
  feedbackIcon: {
    width: '20px',
    height: '20px'
  },
  feedbackText: {
    fontWeight: '500'
  },
  tableContainer: {
    backgroundColor: 'white',
    borderRadius: '24px',
    boxShadow: '0 10px 25px rgba(0, 0, 0, 0.1)',
    border: '1px solid #e2e8f0',
    overflow: 'auto',
    width: '100%',
    transition: 'background 0s',
  },
  tableHeader: {
    background: 'linear-gradient(135deg, #f8fafc, #eff6ff)',
    padding: '2rem',
    borderBottom: '1px solid #e2e8f0'
  },
  tableHeaderContent: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem'
  },
  tableHeaderIcon: {
    width: '40px',
    height: '40px',
    backgroundColor: '#dbeafe',
    borderRadius: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  tableHeaderIconSvg: {
    width: '20px',
    height: '20px',
    color: '#2563eb'
  },
  tableTitle: {
    fontSize: '1.5rem',
    fontWeight: 'bold',
    color: '#1e293b',
    margin: 0
  },
  tableSubtitle: {
    color: '#64748b',
    margin: 0
  },
  tableWrapper: {
    overflowX: 'auto'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse'
  },
  tableHeaderRow: {
    backgroundColor: '#f8fafc',
    borderBottom: '1px solid #e2e8f0'
  },
  tableHeaderCell: {
    textAlign: 'left',
    padding: '1rem 1.5rem',
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#475569',
    whiteSpace: 'nowrap'
  },
  tableRow: {
    transition: 'all 0.3s ease',
    ':hover': {
      backgroundColor: '#f8fafc'
    }
  },
  tableCell: {
    padding: '1rem 1.5rem',
    color: '#475569',
    borderBottom: '1px solid #f1f5f9'
  },
  nomineeTag: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.25rem',
    padding: '0.25rem 0.5rem',
    backgroundColor: '#dbeafe',
    color: '#1d4ed8',
    borderRadius: '8px',
    fontSize: '0.875rem'
  },
  nomineeIcon: {
    width: '12px',
    height: '12px'
  },
  accountTag: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '0.25rem 0.5rem',
    borderRadius: '8px',
    fontSize: '0.875rem',
    fontWeight: '500'
  },
  savingsTag: {
    backgroundColor: '#dcfce7',
    color: '#166534'
  },
  currentTag: {
    backgroundColor: '#fed7aa',
    color: '#c2410c'
  },
  addressCell: {
    padding: '1rem 1.5rem',
    color: '#475569',
    borderBottom: '1px solid #f1f5f9',
    maxWidth: '200px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  emptyState: {
    textAlign: 'center',
    padding: '3rem'
  },
  emptyIcon: {
    width: '48px',
    height: '48px',
    color: '#cbd5e1',
    margin: '0 auto 1rem auto'
  },
  emptyText: {
    color: '#64748b'
  }
};

// Add keyframes for animations
const styleSheet = document.createElement("style");
styleSheet.innerText = `
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }
  
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: .8; }
  }
  /* Force all table row/cell hover/selected backgrounds to white */
  .MuiTableRow-root:hover,
  .MuiTableCell-root:hover,
  .MuiTableRow-hover,
  .MuiTableCell-hover,
  .Mui-selected,
  .MuiTableRow-root.Mui-selected,
  .MuiTableCell-root.Mui-selected,
  .MuiTableRow-root:focus,
  .MuiTableCell-root:focus {
    background-color: white !important;
  }
`;
document.head.appendChild(styleSheet);

export default App;