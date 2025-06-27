import React, { useEffect, useState } from 'react';

function renderCell(value) {
  if (typeof value !== 'string') return value;
  let parsed = null;
  try {
    parsed = JSON.parse(value);
  } catch {
    // Try to fix single quotes to double quotes (not perfect, but helps)
    try {
      parsed = JSON.parse(value.replace(/'/g, '"'));
    } catch {
      // Not JSON, just show as string
      return value;
    }
  }
  if (Array.isArray(parsed)) {
    return (
      <table style={{ background: '#f9f9f9', fontSize: '0.9em', margin: '0.5em 0' }}>
        <thead>
          <tr>
            {Object.keys(parsed[0] || {}).map((k) => (
              <th key={k}>{k}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {parsed.map((row, i) => (
            <tr key={i}>
              {Object.values(row).map((v, j) => (
                <td key={j}>{v}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  } else if (typeof parsed === 'object' && parsed !== null) {
    return (
      <table style={{ background: '#f9f9f9', fontSize: '0.9em', margin: '0.5em 0' }}>
        <tbody>
          {Object.entries(parsed).map(([k, v]) => (
            <tr key={k}>
              <td style={{ fontWeight: 'bold' }}>{k}</td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  return value;
}

const AllDocumentsTable = ({ refreshTrigger }) => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchDocuments = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/all-documents');
      if (!res.ok) throw new Error('Failed to fetch documents');
      const json = await res.json();
      setData(json.data || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, [refreshTrigger]);

  if (loading) return <div>Loading documents...</div>;
  if (error) return <div style={{color: 'red'}}>Error: {error}</div>;
  if (!data.length) return <div>No documents found.</div>;

  // Dynamically get all columns from the first row
  const columns = Object.keys(data[0]);

  return (
    <div style={{overflowX: 'auto', marginTop: '2rem'}}>
      <h2>All Documents</h2>
      <table border="1" cellPadding="6" style={{borderCollapse: 'collapse', minWidth: 600}}>
        <thead>
          <tr>
            {columns.map(col => <th key={col}>{col}</th>)}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i}>
              {columns.map(col => <td key={col}>{renderCell(row[col])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default AllDocumentsTable;
