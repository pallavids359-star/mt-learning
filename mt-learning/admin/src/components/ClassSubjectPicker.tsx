import { useEffect } from 'react';
import { useClasses, useMyTeaching } from '../api/hooks';
import { Field } from './ui';

/** Class + subject selects. Teachers only see the class/subject pairs they are assigned to teach. */
export function ClassSubjectPicker({
  classId,
  subjectId,
  onChange,
  disabled,
  idPrefix,
}: {
  classId: string;
  subjectId: string;
  onChange: (v: { classId: string; subjectId: string }) => void;
  disabled?: boolean;
  idPrefix: string;
}) {
  const classes = useClasses();
  const mine = useMyTeaching();
  const allowed = (cId: string, sId: string) => !mine.data?.restricted || mine.data.pairs.some((p) => p.classId === cId && p.subjectId === sId);
  const classList = (classes.data ?? []).filter((c) => c.subjects.some((s) => allowed(c.id, s.id)));
  const cls = classList.find((c) => c.id === classId);
  const subjectList = (cls?.subjects ?? []).filter((s) => allowed(cls!.id, s.id));

  // Pick sensible defaults once the lists load.
  useEffect(() => {
    if (disabled) return;
    if (!classId && classList.length) {
      const first = classList[0];
      onChange({ classId: first.id, subjectId: first.subjects.filter((s) => allowed(first.id, s.id))[0]?.id ?? '' });
    } else if (cls && subjectId && !subjectList.some((s) => s.id === subjectId)) {
      onChange({ classId, subjectId: subjectList[0]?.id ?? '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classes.data, mine.data, classId]);

  return (
    <>
      <Field label="Class">
        <select
          id={`${idPrefix}-class`}
          required
          disabled={disabled}
          value={classId}
          onChange={(e) => {
            const c = classList.find((x) => x.id === e.target.value);
            onChange({ classId: e.target.value, subjectId: c?.subjects.filter((s) => allowed(c.id, s.id))[0]?.id ?? '' });
          }}
        >
          {!classList.length && <option value="">No classes available</option>}
          {classList.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Subject">
        <select id={`${idPrefix}-subject`} required disabled={disabled} value={subjectId} onChange={(e) => onChange({ classId, subjectId: e.target.value })}>
          {!subjectList.length && <option value="">No subjects</option>}
          {subjectList.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>
    </>
  );
}
