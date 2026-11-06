import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useYears } from '../api/hooks';
import type { ImportResult } from '../api/types';
import { ErrorNote, Field, PageHead, useToast } from '../components/ui';

const TEMPLATE =
  'studentCode,fullName,className,sectionName,rollNumber,dateOfBirth,gender,guardianName,guardianPhone,hostelName,roomNumber\n' +
  'MT26S0101,Ananya Rao,1st PUC Science (PCMB),A,21,2009-05-14,FEMALE,Suresh Rao,9845012345,Girls Hostel,12\n';

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function StudentImportPage() {
  const years = useYears();
  const qc = useQueryClient();
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [yearId, setYearId] = useState('');
  const [check, setCheck] = useState<ImportResult | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function run(dryRun: boolean) {
    if (!file) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await api<ImportResult>('/students/import', { method: 'POST', form, query: { dryRun, academicYearId: yearId || undefined } });
      if (dryRun) setCheck(res);
      else {
        setDone(res);
        setCheck(null);
        toast(`${res.created} students added`);
        void qc.invalidateQueries({ queryKey: ['students'] });
        void qc.invalidateQueries({ queryKey: ['dashboard'] });
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    const csv =
      'studentCode,fullName,temporaryPassword\n' +
      done.credentials.map((c) => [c.studentCode, c.fullName, c.temporaryPassword].map(csvCell).join(',')).join('\n');
    return (
      <>
        <PageHead title="Import complete" sub={`${done.created} students added`} />
        <section className="panel">
          <p>
            Download the sign-in slips now. <strong>Temporary passwords are shown only once</strong> and cannot be retrieved later; if a file is lost,
            reset that student's password instead.
          </p>
          <div className="form-actions left">
            <button className="btn btn-primary" onClick={() => download('student-sign-in-slips.csv', csv)}>
              Download sign-in slips (CSV)
            </button>
            <Link to="/students" className="btn btn-quiet">
              Go to students
            </Link>
          </div>
          <p className="muted small">Store this file securely and delete it after the slips are handed out.</p>
        </section>
      </>
    );
  }

  return (
    <>
      <p className="crumb">
        <Link to="/students">Students</Link>
      </p>
      <PageHead title="Import students from CSV" sub="Add a whole class list at once. Nothing is saved until every row passes the check." />

      <section className="panel stack">
        <ol className="steps">
          <li>
            Prepare a CSV with these columns. Class and section names must match the ones in{' '}
            <Link to="/classes">Classes & sections</Link>.{' '}
            <button className="link-btn" onClick={() => download('student-import-template.csv', TEMPLATE)}>
              Download template
            </button>
          </li>
          <li>Choose the file and check it. Fix any rows listed, then check again.</li>
          <li>Import, then download the sign-in slips with each student's temporary password.</li>
        </ol>
        <p className="muted small mono">
          studentCode, fullName, className, sectionName, rollNumber, dateOfBirth (YYYY-MM-DD), gender, guardianName, guardianPhone, hostelName, roomNumber
        </p>
        <div className="grid-form">
          <Field label="CSV file">
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setCheck(null);
              }}
            />
          </Field>
          <Field label="Academic year">
            <select value={yearId} onChange={(e) => { setYearId(e.target.value); setCheck(null); }}>
              <option value="">Current year</option>
              {years.data?.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name}
                  {y.isCurrent ? ' (current)' : ''}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <ErrorNote error={error} />
        <div className="form-actions left">
          <button className="btn btn-quiet" disabled={!file || busy} onClick={() => void run(true)}>
            {busy && !check ? 'Checking…' : 'Check file'}
          </button>
          <button className="btn btn-primary" disabled={!check?.valid || busy} onClick={() => void run(false)}>
            {busy && check ? 'Importing…' : check?.valid ? `Import ${check.totalRows} students` : 'Import'}
          </button>
        </div>
      </section>

      {check && (
        <section className="panel">
          {check.valid ? (
            <p className="ok-note">All {check.totalRows} rows are ready to import.</p>
          ) : (
            <>
              <h2 className="panel-title">
                {check.errors.length} of {check.totalRows} rows need fixing
              </h2>
              <table className="table">
                <thead>
                  <tr>
                    <th className="num">Row</th>
                    <th>Student ID</th>
                    <th>Problem</th>
                  </tr>
                </thead>
                <tbody>
                  {check.errors.map((e) => (
                    <tr key={e.row}>
                      <td className="num">{e.row}</td>
                      <td className="mono">{e.studentCode ?? '—'}</td>
                      <td>{e.messages.join('. ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      )}
    </>
  );
}
