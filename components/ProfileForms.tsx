"use client";

import { useState } from "react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { type Pattern } from "@/lib/assistant/patterns";
import { WEEKDAYS, type Weekday } from "@/utils/date";
import {
  BUSINESS_STAGE_LABELS,
  DURATION_KEYS,
  EMPLOYMENT_LABELS,
  INTEREST_OPTIONS,
  newId,
  ROLE_OPTIONS,
  SKILL_STATUSES,
  type AIProfile,
  type BusinessStage,
  type BusyBlock,
  type Employment,
  type Role,
  type Skill,
  type SkillStatus,
} from "@/types/persona";
import type { Project } from "@/types/project";

// Edit forms used by the "My AI Persona" page. Each takes the current
// values and returns the changed part through onSave; the page saves it.

function Actions({ onCancel, saving, label = "Save" }: { onCancel: () => void; saving: boolean; label?: string }) {
  return (
    <div className="flex justify-end gap-2 pt-1">
      <Button type="button" variant="secondary" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" disabled={saving}>
        {saving ? "Saving..." : label}
      </Button>
    </div>
  );
}

const DAY_LABELS: Record<Weekday, string> = {
  mon: "Mo",
  tue: "Tu",
  wed: "We",
  thu: "Th",
  fri: "Fr",
  sat: "Sa",
  sun: "Su",
};

function DayPicker({
  value,
  onChange,
  label,
}: {
  value: Weekday[];
  onChange: (days: Weekday[]) => void;
  label: string;
}) {
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-ink">{label}</p>
      <div className="flex gap-1.5" role="group" aria-label={label}>
        {WEEKDAYS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => onChange(value.includes(d) ? value.filter((x) => x !== d) : [...value, d])}
            aria-pressed={value.includes(d)}
            className={`h-10 flex-1 rounded-xl text-sm font-semibold transition ${
              value.includes(d) ? "bg-accent text-white" : "bg-surface-2 text-muted"
            }`}
          >
            {DAY_LABELS[d]}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- about

export type AboutValues = { name: string; roles: Role[]; headline: string; age_range: string };

export function AboutForm({
  initial,
  saving,
  onSave,
  onCancel,
}: {
  initial: AboutValues;
  saving: boolean;
  onSave: (values: AboutValues) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState(initial);
  const toggleRole = (role: Role) =>
    setV((prev) => ({
      ...prev,
      roles: prev.roles.includes(role) ? prev.roles.filter((r) => r !== role) : [...prev.roles, role],
    }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(v);
      }}
      className="space-y-4"
    >
      <Field label="What should the AI call you?">
        {(id) => (
          <Input id={id} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} maxLength={50} placeholder="e.g. Nour" />
        )}
      </Field>
      <div>
        <p className="mb-1.5 text-sm font-medium text-ink">Your roles (pick all that apply)</p>
        <div className="flex flex-wrap gap-2">
          {ROLE_OPTIONS.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => toggleRole(r.value)}
              aria-pressed={v.roles.includes(r.value)}
              className={`rounded-full border px-3.5 py-2 text-sm font-medium transition ${
                v.roles.includes(r.value) ? "border-accent bg-accent text-white" : "border-line text-ink hover:border-accent/40"
              }`}
            >
              {r.emoji} {r.label}
            </button>
          ))}
        </div>
      </div>
      <Field label="In one line, who are you?">
        {(id) => (
          <Input
            id={id}
            value={v.headline}
            onChange={(e) => setV({ ...v, headline: e.target.value })}
            maxLength={100}
            placeholder="e.g. Engineering student & junior developer"
          />
        )}
      </Field>
      <Field label="Age range (optional, not sent to the AI)">
        {(id) => (
          <Select id={id} value={v.age_range} onChange={(e) => setV({ ...v, age_range: e.target.value })}>
            <option value="">Prefer not to say</option>
            {["Under 18", "18-24", "25-34", "35-44", "45-54", "55+"].map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Actions onCancel={onCancel} saving={saving} />
    </form>
  );
}

// ---------------------------------------------------------------- text fields (education)

export function FieldsForm<T extends Record<string, unknown>>({
  fields,
  initial,
  saving,
  onSave,
  onCancel,
}: {
  fields: { key: keyof T & string; label: string; placeholder?: string; long?: boolean; type?: "text" | "date" }[];
  initial: T;
  saving: boolean;
  onSave: (values: T) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.key, typeof initial[f.key] === "string" ? (initial[f.key] as string) : ""]))
  );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          ...initial,
          ...Object.fromEntries(Object.entries(v).map(([k, value]) => [k, value.trim() || undefined])),
        } as T);
      }}
      className="space-y-4"
    >
      {fields.map((f) => (
        <Field key={f.key} label={f.label}>
          {(id) =>
            f.long ? (
              <Textarea
                id={id}
                rows={3}
                maxLength={400}
                value={v[f.key]}
                onChange={(e) => setV({ ...v, [f.key]: e.target.value })}
                placeholder={f.placeholder}
              />
            ) : (
              <Input
                id={id}
                type={f.type ?? "text"}
                maxLength={150}
                value={v[f.key]}
                onChange={(e) => setV({ ...v, [f.key]: e.target.value })}
                placeholder={f.placeholder}
              />
            )
          }
        </Field>
      ))}
      <Actions onCancel={onCancel} saving={saving} />
    </form>
  );
}

// ---------------------------------------------------------------- work

export function WorkForm({
  initial,
  saving,
  onSave,
  onCancel,
}: {
  initial: AIProfile["work"];
  saving: boolean;
  onSave: (work: AIProfile["work"]) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState(initial);
  const text = (key: "job" | "company" | "responsibilities") => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setV({ ...v, [key]: e.target.value || undefined });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(v);
      }}
      className="space-y-4"
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Job">
          {(id) => <Input id={id} value={v.job ?? ""} onChange={text("job")} maxLength={100} placeholder="e.g. Junior developer" />}
        </Field>
        <Field label="Company or business">
          {(id) => <Input id={id} value={v.company ?? ""} onChange={text("company")} maxLength={100} placeholder="e.g. Acme" />}
        </Field>
        <Field label="Type">
          {(id) => (
            <Select
              id={id}
              value={v.employment ?? ""}
              onChange={(e) => setV({ ...v, employment: (e.target.value || undefined) as Employment | undefined })}
            >
              <option value="">Not set</option>
              {(Object.keys(EMPLOYMENT_LABELS) as Employment[]).map((k) => (
                <option key={k} value={k}>
                  {EMPLOYMENT_LABELS[k]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Commute each way (min)">
          {(id) => (
            <Input
              id={id}
              type="number"
              min={0}
              max={300}
              step={5}
              value={v.commute_minutes ?? ""}
              onChange={(e) => setV({ ...v, commute_minutes: e.target.value === "" ? undefined : Number(e.target.value) })}
            />
          )}
        </Field>
      </div>
      <DayPicker label="Days off" value={v.days_off ?? []} onChange={(days_off) => setV({ ...v, days_off })} />
      <p className="text-xs text-muted">Your working hours go in Busy hours, so the AI never plans over them.</p>
      <Field label="Responsibilities">
        {(id) => (
          <Textarea id={id} rows={3} maxLength={400} value={v.responsibilities ?? ""} onChange={text("responsibilities")} placeholder="What you do at work" />
        )}
      </Field>
      <Actions onCancel={onCancel} saving={saving} />
    </form>
  );
}

// ---------------------------------------------------------------- business

export function BusinessForm({
  initial,
  saving,
  onSave,
  onCancel,
}: {
  initial: AIProfile["business"];
  saving: boolean;
  onSave: (business: AIProfile["business"]) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState(initial);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(v);
      }}
      className="space-y-4"
    >
      <Field label="Stage">
        {(id) => (
          <Select
            id={id}
            value={v.stage ?? ""}
            onChange={(e) => setV({ ...v, stage: (e.target.value || undefined) as BusinessStage | undefined })}
          >
            <option value="">Not set</option>
            {(Object.keys(BUSINESS_STAGE_LABELS) as BusinessStage[]).map((k) => (
              <option key={k} value={k}>
                {BUSINESS_STAGE_LABELS[k]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <ChipInput label="Business ideas" values={v.ideas} onChange={(ideas) => setV({ ...v, ideas })} placeholder="e.g. AI automation agency for clinics" />
      <ChipInput label="Business interests" values={v.interests} onChange={(interests) => setV({ ...v, interests })} placeholder="e.g. SaaS, e-commerce" />
      <Actions onCancel={onCancel} saving={saving} />
    </form>
  );
}

// ---------------------------------------------------------------- skills

export function SkillsForm({
  initial,
  saving,
  onSave,
  onCancel,
}: {
  initial: Skill[];
  saving: boolean;
  onSave: (skills: Skill[]) => void;
  onCancel: () => void;
}) {
  const [skills, setSkills] = useState(initial);
  const [name, setName] = useState("");
  const [status, setStatus] = useState<SkillStatus>("want");
  const add = () => {
    const items = name.split(",").map((s) => s.trim()).filter(Boolean);
    const next = [...skills];
    for (const item of items) {
      if (!next.some((s) => s.name.toLowerCase() === item.toLowerCase())) next.push({ name: item, status });
    }
    setSkills(next.slice(0, 40));
    setName("");
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(skills);
      }}
      className="space-y-4"
    >
      <p className="text-sm text-muted">Skills, tools, technologies and topics. The AI suggests learning for what you want to learn.</p>
      <div className="flex gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="e.g. Python, n8n, Sales"
          aria-label="Skill"
        />
        <Select value={status} onChange={(e) => setStatus(e.target.value as SkillStatus)} className="w-auto!" aria-label="Status">
          {SKILL_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
        <Button type="button" variant="secondary" onClick={add} disabled={!name.trim()}>
          Add
        </Button>
      </div>
      {skills.length > 0 && (
        <ul className="divide-y divide-line">
          {skills.map((s) => (
            <li key={s.name} className="flex items-center gap-2 py-2">
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{s.name}</span>
              <Select
                value={s.status}
                onChange={(e) =>
                  setSkills(skills.map((x) => (x.name === s.name ? { ...x, status: e.target.value as SkillStatus } : x)))
                }
                className="w-auto! py-1.5! text-sm"
                aria-label={`Status of ${s.name}`}
              >
                {SKILL_STATUSES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
              <button
                type="button"
                onClick={() => setSkills(skills.filter((x) => x.name !== s.name))}
                className="rounded-lg px-2 py-1 text-muted hover:text-danger"
                aria-label={`Remove ${s.name}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <Actions onCancel={onCancel} saving={saving} />
    </form>
  );
}

// ---------------------------------------------------------------- interests

function ChipInput({
  label,
  values,
  onChange,
  placeholder,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
}) {
  const [text, setText] = useState("");
  const add = () => {
    const items = text.split(",").map((s) => s.trim()).filter(Boolean);
    const next = [...values];
    for (const item of items) {
      if (!next.some((v) => v.toLowerCase() === item.toLowerCase())) next.push(item);
    }
    onChange(next.slice(0, 30));
    setText("");
  };
  return (
    <Field label={label}>
      {(id) => (
        <div>
          <div className="flex gap-2">
            <Input
              id={id}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
              placeholder={placeholder}
            />
            <Button type="button" variant="secondary" onClick={add} disabled={!text.trim()}>
              Add
            </Button>
          </div>
          {values.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {values.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => onChange(values.filter((x) => x !== v))}
                  className="rounded-full bg-accent-soft px-3 py-1 text-sm text-accent hover:bg-danger-soft hover:text-danger"
                  aria-label={`Remove ${v}`}
                >
                  {v} ×
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </Field>
  );
}

export function InterestsForm({
  initial,
  saving,
  onSave,
  onCancel,
}: {
  initial: string[];
  saving: boolean;
  onSave: (interests: string[]) => void;
  onCancel: () => void;
}) {
  const [interests, setInterests] = useState(initial);
  const custom = interests.filter((i) => !INTEREST_OPTIONS.includes(i));
  const toggle = (o: string) => setInterests((p) => (p.includes(o) ? p.filter((x) => x !== o) : [...p, o]));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(interests);
      }}
      className="space-y-4"
    >
      <div className="flex flex-wrap gap-1.5">
        {INTEREST_OPTIONS.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => toggle(o)}
            aria-pressed={interests.includes(o)}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
              interests.includes(o) ? "border-accent bg-accent text-white" : "border-line text-ink hover:border-accent/40"
            }`}
          >
            {o}
          </button>
        ))}
      </div>
      <ChipInput
        label="Other interests"
        values={custom}
        onChange={(next) => setInterests([...interests.filter((i) => INTEREST_OPTIONS.includes(i)), ...next])}
        placeholder="e.g. Public speaking"
      />
      <Actions onCancel={onCancel} saving={saving} />
    </form>
  );
}

// ---------------------------------------------------------------- schedule & preferences

export type ScheduleValues = Pick<AIProfile, "schedule" | "preferences">;

const DURATION_LABELS: Record<(typeof DURATION_KEYS)[number], string> = {
  study: "Study",
  work: "Work",
  project: "Project",
  exercise: "Exercise",
  reading: "Reading",
};

export function ScheduleForm({
  initial,
  roles,
  saving,
  onSave,
  onCancel,
}: {
  initial: ScheduleValues;
  roles: Role[];
  saving: boolean;
  onSave: (values: ScheduleValues) => void;
  onCancel: () => void;
}) {
  const [s, setS] = useState(initial.schedule);
  const [p, setP] = useState(initial.preferences);
  const text = (key: "wake" | "sleep" | "study_time" | "project_time") => (e: React.ChangeEvent<HTMLInputElement>) =>
    setS((prev) => ({ ...prev, [key]: e.target.value || undefined }));
  const pref = (key: "energy" | "session" | "intensity") => (e: React.ChangeEvent<HTMLSelectElement>) =>
    setP((prev) => ({ ...prev, [key]: e.target.value || undefined }));
  const balanceRoles = roles.filter((r) => r !== "other");
  const balanceTotal = balanceRoles.reduce((sum, r) => sum + (p.balance?.[r] ?? 0), 0);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ schedule: s, preferences: p });
      }}
      className="space-y-4"
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Wake up">{(id) => <Input id={id} type="time" value={s.wake ?? ""} onChange={text("wake")} />}</Field>
        <Field label="Sleep">{(id) => <Input id={id} type="time" value={s.sleep ?? ""} onChange={text("sleep")} />}</Field>
      </div>
      <DayPicker label="Rest days (nothing gets planned)" value={s.rest_days ?? []} onChange={(rest_days) => setS({ ...s, rest_days })} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Best time to study">
          {(id) => <Input id={id} value={s.study_time ?? ""} onChange={text("study_time")} maxLength={100} placeholder="e.g. After 20:00" />}
        </Field>
        <Field label="Best time for projects">
          {(id) => <Input id={id} value={s.project_time ?? ""} onChange={text("project_time")} maxLength={100} placeholder="e.g. Weekends" />}
        </Field>
        <Field label="Focused hours a day (capacity)">
          {(id) => (
            <Input
              id={id}
              type="number"
              min={0}
              max={16}
              step={0.5}
              value={s.daily_hours ?? ""}
              onChange={(e) => setS((prev) => ({ ...prev, daily_hours: e.target.value === "" ? undefined : Number(e.target.value) }))}
            />
          )}
        </Field>
        <Field label="Tasks per day">
          {(id) => (
            <Input
              id={id}
              type="number"
              min={1}
              max={30}
              value={p.tasks_per_day ?? ""}
              onChange={(e) => setP((prev) => ({ ...prev, tasks_per_day: e.target.value === "" ? undefined : Number(e.target.value) }))}
            />
          )}
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Best energy">
          {(id) => (
            <Select id={id} value={p.energy ?? ""} onChange={pref("energy")}>
              <option value="">Not set</option>
              <option value="morning">Morning</option>
              <option value="evening">Evening</option>
              <option value="flexible">Flexible</option>
            </Select>
          )}
        </Field>
        <Field label="Sessions">
          {(id) => (
            <Select id={id} value={p.session ?? ""} onChange={pref("session")}>
              <option value="">Not set</option>
              <option value="long">Long, focused</option>
              <option value="short">Short</option>
              <option value="mixed">Mixed</option>
            </Select>
          )}
        </Field>
        <Field label="Schedule">
          {(id) => (
            <Select id={id} value={p.intensity ?? ""} onChange={pref("intensity")}>
              <option value="">Not set</option>
              <option value="relaxed">Relaxed</option>
              <option value="balanced">Balanced</option>
              <option value="aggressive">Aggressive</option>
            </Select>
          )}
        </Field>
      </div>
      <div>
        <p className="mb-1.5 text-sm font-medium text-ink">Usual session length (minutes)</p>
        <div className="grid grid-cols-5 gap-2">
          {DURATION_KEYS.map((k) => (
            <label key={k} className="text-xs text-muted">
              {DURATION_LABELS[k]}
              <Input
                type="number"
                min={5}
                max={480}
                step={5}
                value={p.durations?.[k] ?? ""}
                onChange={(e) =>
                  setP((prev) => ({
                    ...prev,
                    durations: { ...prev.durations, [k]: e.target.value === "" ? undefined : Number(e.target.value) },
                  }))
                }
                className="mt-1 px-2!"
              />
            </label>
          ))}
        </div>
      </div>
      {balanceRoles.length > 1 && (
        <div>
          <p className="mb-1.5 text-sm font-medium text-ink">
            How you want to split your time{" "}
            <span className={`font-normal ${balanceTotal && balanceTotal !== 100 ? "text-warn" : "text-muted"}`}>
              ({balanceTotal}%)
            </span>
          </p>
          <div className="grid grid-cols-2 gap-2">
            {balanceRoles.map((role) => (
              <label key={role} className="flex items-center gap-2 text-sm text-ink">
                <span className="flex-1">{ROLE_OPTIONS.find((o) => o.value === role)?.label}</span>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={5}
                  value={p.balance?.[role] ?? ""}
                  onChange={(e) =>
                    setP((prev) => ({
                      ...prev,
                      balance: { ...prev.balance, [role]: e.target.value === "" ? undefined : Number(e.target.value) },
                    }))
                  }
                  className="w-20! px-2!"
                  aria-label={`${role} %`}
                />
                %
              </label>
            ))}
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Free time to keep every day">
          {(id) => (
            <Input
              id={id}
              value={p.free_time ?? ""}
              onChange={(e) => setP((prev) => ({ ...prev, free_time: e.target.value || undefined }))}
              maxLength={100}
              placeholder="e.g. 2 hours"
            />
          )}
        </Field>
        <Field label="AI language">
          {(id) => (
            <Input
              id={id}
              value={p.language ?? ""}
              onChange={(e) => setP((prev) => ({ ...prev, language: e.target.value || undefined }))}
              maxLength={40}
              placeholder="e.g. Arabic (default: yours)"
            />
          )}
        </Field>
      </div>
      <Actions onCancel={onCancel} saving={saving} />
    </form>
  );
}

// ---------------------------------------------------------------- routines

export type RoutineValues = {
  title: string;
  pattern: Pattern;
  due_time: string | null;
  estimated_duration: number | null;
};

export function RoutineForm({
  initial,
  saving,
  onSave,
  onCancel,
}: {
  initial: RoutineValues | null;
  saving: boolean;
  onSave: (routine: RoutineValues) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.title ?? "");
  const [type, setType] = useState<Pattern["type"]>(initial?.pattern.type ?? "daily");
  const [days, setDays] = useState<Weekday[]>(initial?.pattern.type === "days_of_week" ? initial.pattern.days : ["mon", "wed", "fri"]);
  const [n, setN] = useState(initial?.pattern.type === "every_n_days" ? initial.pattern.n : 2);
  const [on, setOn] = useState(initial?.pattern.type === "on_off" ? initial.pattern.on_days : 3);
  const [off, setOff] = useState(initial?.pattern.type === "on_off" ? initial.pattern.off_days : 1);
  const [day, setDay] = useState(initial?.pattern.type === "monthly" ? initial.pattern.day : 1);
  const [time, setTime] = useState(initial?.due_time?.slice(0, 5) ?? "");
  const [duration, setDuration] = useState(initial?.estimated_duration ? String(initial.estimated_duration) : "");

  const pattern = (): Pattern => {
    switch (type) {
      case "days_of_week":
        return { type, days: days.length ? days : ["mon"] };
      case "every_n_days":
        return { type, n: Math.min(Math.max(n, 1), 60) };
      case "on_off":
        return { type, on_days: Math.min(Math.max(on, 1), 30), off_days: Math.min(Math.max(off, 0), 30) };
      case "monthly":
        return { type, day: Math.min(Math.max(day, 1), 31) };
      default:
        return { type } as Pattern;
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const minutes = Number(duration);
        onSave({
          title: name.trim(),
          pattern: pattern(),
          due_time: time || null,
          estimated_duration: duration && minutes >= 5 ? Math.min(minutes, 720) : null,
        });
      }}
      className="space-y-4"
    >
      <Field label="Activity">
        {(id) => (
          <Input id={id} value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} placeholder="e.g. Gym" autoFocus={!initial} />
        )}
      </Field>
      <Field label="How often?">
        {(id) => (
          <Select id={id} value={type} onChange={(e) => setType(e.target.value as Pattern["type"])}>
            <option value="daily">Every day</option>
            <option value="weekdays">Every weekday</option>
            <option value="weekends">Every weekend</option>
            <option value="days_of_week">Specific days</option>
            <option value="every_n_days">Every few days</option>
            <option value="on_off">Days on / days off</option>
            <option value="monthly">Once a month</option>
          </Select>
        )}
      </Field>
      {type === "days_of_week" && <DayPicker label="Days" value={days} onChange={setDays} />}
      {type === "every_n_days" && (
        <Field label="Every how many days?">
          {(id) => <Input id={id} type="number" min={1} max={60} value={n} onChange={(e) => setN(Number(e.target.value))} />}
        </Field>
      )}
      {type === "on_off" && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Days on">
            {(id) => <Input id={id} type="number" min={1} max={30} value={on} onChange={(e) => setOn(Number(e.target.value))} />}
          </Field>
          <Field label="Days off">
            {(id) => <Input id={id} type="number" min={0} max={30} value={off} onChange={(e) => setOff(Number(e.target.value))} />}
          </Field>
        </div>
      )}
      {type === "monthly" && (
        <Field label="Day of the month">
          {(id) => <Input id={id} type="number" min={1} max={31} value={day} onChange={(e) => setDay(Number(e.target.value))} />}
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Time (optional)">
          {(id) => <Input id={id} type="time" value={time} onChange={(e) => setTime(e.target.value)} />}
        </Field>
        <Field label="Minutes (optional)">
          {(id) => <Input id={id} type="number" min={5} max={720} step={5} value={duration} onChange={(e) => setDuration(e.target.value)} />}
        </Field>
      </div>
      <p className="text-xs text-muted">Routines go on your calendar and keep going until you stop them.</p>
      <Actions onCancel={onCancel} saving={saving} label={initial ? "Save" : "Add routine"} />
    </form>
  );
}

// ---------------------------------------------------------------- instructions

export function InstructionsForm({
  initial,
  saving,
  onSave,
  onCancel,
}: {
  initial: string;
  saving: boolean;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(text.trim());
      }}
      className="space-y-4"
    >
      <Field label="What else should your AI know about how you like to work?">
        {(id) => (
          <Textarea
            id={id}
            rows={5}
            maxLength={1000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. Never schedule anything on Friday mornings. Keep study sessions under an hour. Remind me to take breaks."
          />
        )}
      </Field>
      <Actions onCancel={onCancel} saving={saving} />
    </form>
  );
}

// ---------------------------------------------------------------- busy hours

export function BlockForm({
  initial,
  courses,
  saving,
  onSave,
  onCancel,
}: {
  initial: BusyBlock | null;
  courses: Project[];
  saving: boolean;
  onSave: (block: BusyBlock) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(initial?.label ?? "");
  const [days, setDays] = useState<Weekday[]>(initial?.days ?? ["sun", "mon", "tue", "wed", "thu"]);
  const [start, setStart] = useState(initial?.start ?? "09:00");
  const [end, setEnd] = useState(initial?.end ?? "17:00");
  const [from, setFrom] = useState(initial?.valid_from ?? "");
  const [until, setUntil] = useState(initial?.valid_until ?? "");
  const [courseId, setCourseId] = useState(initial?.course_id ?? "");
  const overnight = end < start;
  const valid = label.trim() && days.length > 0 && start !== end && (!from || !until || until >= from);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        onSave({
          id: initial?.id ?? newId(),
          label: label.trim(),
          days,
          start,
          end,
          ...(from && { valid_from: from }),
          ...(until && { valid_until: until }),
          ...(courseId && { course_id: courseId }),
        });
      }}
      className="space-y-4"
    >
      <Field label="What is it?">
        {(id) => (
          <Input id={id} value={label} onChange={(e) => setLabel(e.target.value)} required maxLength={40} placeholder="e.g. Work, University, Database lecture" autoFocus={!initial} />
        )}
      </Field>
      <DayPicker label="Days" value={days} onChange={setDays} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="From">{(id) => <Input id={id} type="time" value={start} onChange={(e) => setStart(e.target.value)} required />}</Field>
        <Field label="To">{(id) => <Input id={id} type="time" value={end} onChange={(e) => setEnd(e.target.value)} required />}</Field>
      </div>
      {overnight && <p className="text-sm text-muted">🌙 Overnight: ends the next morning at {end}.</p>}
      {start === end && <p className="text-sm text-danger">Start and end can&apos;t be the same.</p>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Starting (optional)">{(id) => <Input id={id} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
        <Field label="Until (e.g. semester end)">{(id) => <Input id={id} type="date" value={until} onChange={(e) => setUntil(e.target.value)} />}</Field>
      </div>
      {courses.length > 0 && (
        <Field label="Lecture of a course (optional)">
          {(id) => (
            <Select id={id} value={courseId} onChange={(e) => setCourseId(e.target.value)}>
              <option value="">No</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      <Actions onCancel={onCancel} saving={saving || !valid} label={initial ? "Save" : "Add busy hours"} />
    </form>
  );
}
