import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useHostels } from '../api/hooks';
import type { Hostel, Page, Staff } from '../api/types';
import { P, useAuth } from '../auth/AuthContext';
import { Empty, ErrorNote, Field, Loading, Modal, PageHead, useToast } from '../components/ui';

export function HostelsPage() {
  const { can } = useAuth();
  const write = can(P.HostelsWrite);
  const q = useHostels();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<Hostel | 'new' | null>(null);

  return (
    <>
      <PageHead title="Hostels" actions={write && <button className="btn btn-primary" onClick={() => setEditing('new')}>Add hostel</button>} />
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorNote error={q.error} />
      ) : !q.data!.length ? (
        <Empty title="No hostels yet">Add each hostel block so students can be assigned rooms.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Hostel</th>
                <th>Warden</th>
                <th className="num">Residents</th>
                {write && <th className="num"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {q.data!.map((h) => (
                <tr key={h.id}>
                  <td>
                    <Link to={`/students?hostelId=${h.id}`} className="strong-link">{h.name}</Link>
                  </td>
                  <td>{h.wardenName ?? <span className="muted">Not assigned</span>}</td>
                  <td className="num">{h.studentCount}</td>
                  {write && (
                    <td className="num">
                      <button className="btn btn-quiet btn-sm" onClick={() => setEditing(h)}>Edit</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={!!editing} title={editing === 'new' ? 'Add hostel' : 'Edit hostel'} onClose={() => setEditing(null)}>
        {editing && (
          <HostelForm
            hostel={editing === 'new' ? null : editing}
            onDone={() => {
              void qc.invalidateQueries({ queryKey: ['hostels'] });
              toast(editing === 'new' ? 'Hostel added' : 'Hostel saved');
              setEditing(null);
            }}
            onCancel={() => setEditing(null)}
          />
        )}
      </Modal>
    </>
  );
}

function HostelForm({ hostel, onDone, onCancel }: { hostel: Hostel | null; onDone: () => void; onCancel: () => void }) {
  const { can } = useAuth();
  const wardens = useQuery({
    queryKey: ['staff', 'wardens'],
    queryFn: () => api<Page<Staff>>('/staff', { query: { role: 'HOSTEL_WARDEN', status: 'ACTIVE', pageSize: 200 } }),
    enabled: can(P.StaffRead),
  });
  const [name, setName] = useState(hostel?.name ?? '');
  const [wardenId, setWarden] = useState(hostel?.wardenId ?? '');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { name, ...(can(P.StaffRead) && { wardenId: wardenId || null }) };
      if (hostel) await api(`/hostels/${hostel.id}`, { method: 'PATCH', body });
      else await api('/hostels', { method: 'POST', body });
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="stack">
      <Field label="Hostel name"><input required value={name} onChange={(e) => setName(e.target.value)} /></Field>
      {can(P.StaffRead) && (
        <Field label="Warden" hint="Only staff with the Hostel Warden role are listed">
          <select value={wardenId} onChange={(e) => setWarden(e.target.value)}>
            <option value="">Not assigned</option>
            {wardens.data?.items.map((w) => <option key={w.id} value={w.id}>{w.fullName}</option>)}
          </select>
        </Field>
      )}
      <ErrorNote error={error} />
      <div className="form-actions">
        <button type="button" className="btn btn-quiet" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : hostel ? 'Save hostel' : 'Add hostel'}</button>
      </div>
    </form>
  );
}
