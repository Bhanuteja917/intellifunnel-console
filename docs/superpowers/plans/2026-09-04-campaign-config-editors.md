# Campaign Configuration Editors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish PRD epic E3 (campaign configuration) by giving the campaign detail page (`/campaigns/[id]`) working editors for the three pieces of config that already have backend support but no UI: ICP criteria, lead field spec, and channels.

**Architecture:** `src/lib/campaigns/crud.ts` already exports `setIcpCriteria` and `setLeadFieldSpec` (both full-replace: delete-all-then-recreate) and `addCampaignChannel` (additive, one row at a time). Each gets a new server action in `src/app/(admin)/campaigns/[id]/actions.ts` (new file — the existing `src/app/(admin)/campaigns/actions.ts` is for the campaigns *list* page, not the detail page; keep them separate) and a dedicated client component. All three backend functions call `assertDraftAndAccessible`, which throws `ValidationError` unless `campaign.status === "draft"` — every editor must only render its edit controls when the campaign is a draft, and always render its current values read-only otherwise (the existing read-only tables already do this correctly for display; you're adding edit affordances on top, gated the same way).

**Tech Stack:** Next.js App Router server actions, shadcn/ui (`dialog`, `select`, `input`, `checkbox`, `table`, `button`, `field`, `label` — all already present in `src/components/ui/`, `checkbox.tsx` just added), `sonner` toasts, `zustand` is NOT needed here (local `useState` is enough — these are small, page-scoped forms).

**Spec:** none — scoped directly from a live gap review of PRD epic E3 in this session (backend was complete, UI was read-only-only). This plan's Global Constraints are the binding requirements.

## Global Constraints

- Every mutation goes through a server action in `src/app/(admin)/campaigns/[id]/actions.ts`, which calls `requireActor()` then the `src/lib/campaigns/crud.ts` function, wrapped in `toActionResult` (same pattern as every existing action in this codebase — see `src/app/(admin)/campaigns/actions.ts` or `src/app/(admin)/organizations/actions.ts` for the exact shape: `return toActionResult(async () => { const actor = await requireActor(); ...; revalidatePath(...); return ...; });`). Do not call `crud.ts` functions directly from a client component.
- Do not re-implement `assertDraftAndAccessible`'s status check in the UI as the source of truth — the UI gating (`isDraft` prop) is a UX convenience only, matching how `ApprovalActions` (`src/app/(admin)/campaigns/[id]/approval-actions.tsx`) already gates its buttons on `props.status`. The server call is what actually enforces it; if it throws `ValidationError`, that surfaces through `toActionResult` → `result.error` → `toast.error(result.error)`, same as every other action in this codebase.
- `setIcpCriteria` and `setLeadFieldSpec` are **full-replace**: the action takes the complete array every time, not a single added/removed row. Build the array client-side (add/remove rows in local component state) and submit the whole thing on one "Save" click. Do not try to diff and send incremental changes — the backend doesn't support that and doesn't need to.
- `addCampaignChannel` is **additive** — one channel at a time, via a dialog, matching the existing `ApprovalActions` reject-dialog pattern (`Dialog`/`DialogTrigger`/`DialogContent`/`DialogFooter` from `@/components/ui/dialog`).
- Match the existing action-calling pattern exactly: `useTransition` for pending state, `toast.success(...)` / `toast.error(result.error)` on the `ActionResult`, no separate loading spinners. See `src/app/(admin)/campaigns/[id]/approval-actions.tsx` for the canonical example already in this codebase.
- Do not add new npm dependencies. `checkbox.tsx` was already added and normalized to `@/lib/utils`'s `cn` (matching the other 19 files in `src/components/ui/`) in the prior commit `51e2780` — every `ui/` component now imports `cn` from `@/lib/utils`, none from the bare `cn` package.
- TypeScript must pass with zero errors: `npx tsc --noEmit`. Run `npx eslint <changed files>` too and fix anything it flags.
- Commit at the end of each task (not each step) — one coherent commit per task, `git add` only the files that task's Files section lists.

## Reference: enums and shapes you'll need (copy verbatim, do not guess these)

```ts
// IcpDimension (prisma/schema.prisma)
type IcpDimension = "industry" | "employeeRange" | "revenueRange" | "country" | "region" | "jobFunction" | "seniority" | "jobTitle" | "custom";
const ICP_DIMENSIONS: IcpDimension[] = ["industry", "employeeRange", "revenueRange", "country", "region", "jobFunction", "seniority", "jobTitle", "custom"];

// IcpOperator
type IcpOperator = "in" | "notIn" | "between" | "contains";
const ICP_OPERATORS: IcpOperator[] = ["in", "notIn", "between", "contains"];

// LeadFieldDataType
type LeadFieldDataType = "string" | "number" | "boolean" | "date" | "email" | "phone" | "url";
const LEAD_FIELD_DATA_TYPES: LeadFieldDataType[] = ["string", "number", "boolean", "date", "email", "phone", "url"];
```

`src/lib/campaigns/crud.ts` exports these input types (read the file — don't redeclare them differently):
```ts
export type IcpCriterionInput = { dimension: IcpDimension; operator: IcpOperator; values: unknown[]; isMandatory: boolean; };
export async function setIcpCriteria(db: PrismaClient, actor: Actor, campaignId: string, criteria: IcpCriterionInput[]): Promise<void>

export type LeadFieldSpecInput = { fieldKey: string; label: string; dataType: LeadFieldDataType; isRequired: boolean; rejectIfMissing: boolean; allowedValues?: unknown[]; validationPattern?: string; };
export async function setLeadFieldSpec(db: PrismaClient, actor: Actor, campaignId: string, fields: LeadFieldSpecInput[]): Promise<void>

export type CampaignChannelInput = { channelTypeVersionId: string; contractedQuantity: number; clientUnitPrice: string; costBudget?: string; currency: string; startDate: Date; endDate: Date; qualificationFormId?: string; };
export async function addCampaignChannel(db: PrismaClient, actor: Actor, campaignId: string, input: CampaignChannelInput): Promise<CampaignChannel>
```

`getCampaignForActor` (same file) already returns `campaign.icpCriteria`, `campaign.leadFieldSpecs`, `campaign.channels` (with `channelTypeVersion` included) — the page already fetches all of this, you're adding UI for it, not new queries (Task 3 is the one exception — it needs a list of available channel types, see its own Files section).

---

## Task 1: ICP criteria editor

**Files:**
- Create: `src/app/(admin)/campaigns/[id]/actions.ts`
- Create: `src/app/(admin)/campaigns/[id]/icp-criteria-editor.tsx`
- Modify: `src/app/(admin)/campaigns/[id]/page.tsx`

**Interfaces:**
- Produces: `setIcpCriteriaAction(campaignId: string, criteria: IcpCriterionInput[]): Promise<ActionResult<null>>` in the new `actions.ts` file — Tasks 2 and 3 will add their own actions to this same file (append, don't overwrite).
- Produces: `IcpCriteriaEditor`, a client component, props `{ campaignId: string; initialCriteria: { dimension: IcpDimension; operator: IcpOperator; values: unknown[]; isMandatory: boolean }[]; canEdit: boolean }`.
- Consumes: nothing from another task.

- [ ] **Step 1: Read for context**

  Read `src/app/(admin)/campaigns/[id]/page.tsx`, `src/app/(admin)/campaigns/[id]/approval-actions.tsx`, and `src/lib/campaigns/crud.ts`'s `setIcpCriteria` function in full before writing anything.

- [ ] **Step 2: Create `src/app/(admin)/campaigns/[id]/actions.ts`**

  ```tsx
  "use server";

  import { revalidatePath } from "next/cache";
  import { db } from "@/lib/db";
  import { requireActor, toActionResult, type ActionResult } from "@/lib/auth/require";
  import { setIcpCriteria, type IcpCriterionInput } from "@/lib/campaigns/crud";

  export async function setIcpCriteriaAction(
    campaignId: string,
    criteria: IcpCriterionInput[],
  ): Promise<ActionResult<null>> {
    return toActionResult(async () => {
      const actor = await requireActor();
      await setIcpCriteria(db, actor, campaignId, criteria);
      revalidatePath(`/campaigns/${campaignId}`);
      return null;
    });
  }
  ```

- [ ] **Step 3: Create `src/app/(admin)/campaigns/[id]/icp-criteria-editor.tsx`**

  A row-based editor: each row is one criterion (dimension select, operator select, a comma-separated values text input, a mandatory checkbox, a remove button). "Add criterion" appends a blank row. "Save" submits the whole array. When `canEdit` is false, render the existing read-only table instead (the same markup `page.tsx` currently has inline for ICP criteria — Step 4 removes that inline markup from `page.tsx` in favor of this component owning both the read-only and editable views).

  ```tsx
  "use client";

  import { useState, useTransition } from "react";
  import { toast } from "sonner";
  import { Button } from "@/components/ui/button";
  import { Checkbox } from "@/components/ui/checkbox";
  import { Input } from "@/components/ui/input";
  import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue,
  } from "@/components/ui/select";
  import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
  } from "@/components/ui/table";
  import { setIcpCriteriaAction } from "./actions";

  type IcpDimension = "industry" | "employeeRange" | "revenueRange" | "country" | "region" | "jobFunction" | "seniority" | "jobTitle" | "custom";
  type IcpOperator = "in" | "notIn" | "between" | "contains";

  const ICP_DIMENSIONS: IcpDimension[] = ["industry", "employeeRange", "revenueRange", "country", "region", "jobFunction", "seniority", "jobTitle", "custom"];
  const ICP_OPERATORS: IcpOperator[] = ["in", "notIn", "between", "contains"];

  type Row = {
    dimension: IcpDimension;
    operator: IcpOperator;
    valuesText: string; // comma-separated, parsed to string[] on save
    isMandatory: boolean;
  };

  type Props = {
    campaignId: string;
    initialCriteria: { dimension: IcpDimension; operator: IcpOperator; values: unknown[]; isMandatory: boolean }[];
    canEdit: boolean;
  };

  function toRow(criterion: Props["initialCriteria"][number]): Row {
    return {
      dimension: criterion.dimension,
      operator: criterion.operator,
      valuesText: criterion.values.map((v) => String(v)).join(", "),
      isMandatory: criterion.isMandatory,
    };
  }

  export function IcpCriteriaEditor({ campaignId, initialCriteria, canEdit }: Props) {
    const [pending, startTransition] = useTransition();
    const [rows, setRows] = useState<Row[]>(() => initialCriteria.map(toRow));

    if (!canEdit) {
      return (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Dimension</TableHead>
              <TableHead>Operator</TableHead>
              <TableHead>Values</TableHead>
              <TableHead>Mandatory</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {initialCriteria.map((criterion, index) => (
              <TableRow key={index}>
                <TableCell>{criterion.dimension}</TableCell>
                <TableCell>{criterion.operator}</TableCell>
                <TableCell>{criterion.values.map((v) => String(v)).join(", ")}</TableCell>
                <TableCell>{criterion.isMandatory ? "yes" : "advisory"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      );
    }

    function updateRow(index: number, patch: Partial<Row>) {
      setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    }

    function addRow() {
      setRows((prev) => [...prev, { dimension: "industry", operator: "in", valuesText: "", isMandatory: true }]);
    }

    function removeRow(index: number) {
      setRows((prev) => prev.filter((_, i) => i !== index));
    }

    function save() {
      const criteria = rows.map((row) => ({
        dimension: row.dimension,
        operator: row.operator,
        values: row.valuesText.split(",").map((v) => v.trim()).filter((v) => v !== ""),
        isMandatory: row.isMandatory,
      }));
      startTransition(async () => {
        const result = await setIcpCriteriaAction(campaignId, criteria);
        if (result.ok) {
          toast.success("ICP criteria saved");
        } else {
          toast.error(result.error);
        }
      });
    }

    return (
      <div className="flex flex-col gap-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Dimension</TableHead>
              <TableHead>Operator</TableHead>
              <TableHead>Values (comma-separated)</TableHead>
              <TableHead>Mandatory</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, index) => (
              <TableRow key={index}>
                <TableCell>
                  <Select value={row.dimension} onValueChange={(value) => updateRow(index, { dimension: value as IcpDimension })}>
                    <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {ICP_DIMENSIONS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Select value={row.operator} onValueChange={(value) => updateRow(index, { operator: value as IcpOperator })}>
                    <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {ICP_OPERATORS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Input
                    value={row.valuesText}
                    onChange={(event) => updateRow(index, { valuesText: event.target.value })}
                    placeholder="e.g. Software, Fintech"
                  />
                </TableCell>
                <TableCell>
                  <Checkbox
                    checked={row.isMandatory}
                    onCheckedChange={(checked) => updateRow(index, { isMandatory: checked === true })}
                  />
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="sm" onClick={() => removeRow(index)}>Remove</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex justify-between">
          <Button variant="outline" size="sm" onClick={addRow}>Add criterion</Button>
          <Button size="sm" disabled={pending} onClick={save}>Save ICP criteria</Button>
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 4: Wire into `page.tsx`**

  Replace the existing inline "ICP criteria" `Card`'s `CardContent` (the one with the hardcoded `<Table>` reading `campaign.icpCriteria`) with:

  ```tsx
  <CardContent>
    <IcpCriteriaEditor
      campaignId={campaign.id}
      initialCriteria={campaign.icpCriteria.map((c) => ({
        dimension: c.dimension,
        operator: c.operator,
        values: c.valuesJson as unknown[],
        isMandatory: c.isMandatory,
      }))}
      canEdit={hasPermission(actor, "campaign:write") && campaign.status === "draft"}
    />
  </CardContent>
  ```

  Add `import { IcpCriteriaEditor } from "./icp-criteria-editor";` at the top. `hasPermission` is already imported in this file (it's used for `ApprovalActions`'s props). Remove the now-unused `Table`/`TableBody`/`TableCell`/`TableHead`/`TableHeader`/`TableRow` imports from `page.tsx` **only if** Task 1 is the only table left using them — it isn't (the Channels table is still inline until Task 3), so leave those imports in place for now.

- [ ] **Step 5: Verify**

  `npx tsc --noEmit` clean. Then curl-verify against the running dev server (session cookie via the same sign-in endpoint used throughout this session: `bhanu@intellifunnel.io` / `TestPass123!` against `POST /api/auth/sign-in/email`) that `/campaigns/<a-real-campaign-id>` returns 200. If there are zero campaigns in the database, create one first through the already-working `/campaigns/new` UI via curl (or note in your report that you couldn't get a campaign id and what you'd have checked). Report what you found.

- [ ] **Step 6: Commit**

  `git add src/app/(admin)/campaigns/[id]/actions.ts src/app/(admin)/campaigns/[id]/icp-criteria-editor.tsx "src/app/(admin)/campaigns/[id]/page.tsx"` and commit with your own message.

---

## Task 2: Lead field spec editor

**Files:**
- Modify: `src/app/(admin)/campaigns/[id]/actions.ts` (append — Task 1 already created this file, do not recreate it or remove `setIcpCriteriaAction`)
- Create: `src/app/(admin)/campaigns/[id]/lead-field-spec-editor.tsx`
- Modify: `src/app/(admin)/campaigns/[id]/page.tsx`

**Interfaces:**
- Consumes: `src/app/(admin)/campaigns/[id]/actions.ts` as it exists after Task 1 (already has `setIcpCriteriaAction`) — append a new export, don't touch the existing one.
- Produces: `setLeadFieldSpecAction(campaignId: string, fields: LeadFieldSpecInput[]): Promise<ActionResult<null>>`.
- Produces: `LeadFieldSpecEditor`, a client component, props `{ campaignId: string; initialFields: { fieldKey: string; label: string; dataType: LeadFieldDataType; isRequired: boolean; rejectIfMissing: boolean; allowedValues?: unknown[]; validationPattern?: string }[]; canEdit: boolean }`.

Note: `page.tsx` currently has **no** card for lead field specs at all (only ICP criteria and Channels are rendered, even read-only) — you're adding a new `Card` section, not replacing an existing one.

- [ ] **Step 1: Read for context**

  Read the current `src/app/(admin)/campaigns/[id]/page.tsx` (as left by Task 1), `src/app/(admin)/campaigns/[id]/actions.ts` (as left by Task 1), and `src/lib/campaigns/crud.ts`'s `setLeadFieldSpec` function.

- [ ] **Step 2: Append to `actions.ts`**

  Add this export alongside the existing `setIcpCriteriaAction` (don't remove or modify it):

  ```tsx
  import { setLeadFieldSpec, type LeadFieldSpecInput } from "@/lib/campaigns/crud";
  // (add to the existing import line from "@/lib/campaigns/crud" rather than a second import statement, i.e.
  //  `import { setIcpCriteria, setLeadFieldSpec, type IcpCriterionInput, type LeadFieldSpecInput } from "@/lib/campaigns/crud";`)

  export async function setLeadFieldSpecAction(
    campaignId: string,
    fields: LeadFieldSpecInput[],
  ): Promise<ActionResult<null>> {
    return toActionResult(async () => {
      const actor = await requireActor();
      await setLeadFieldSpec(db, actor, campaignId, fields);
      revalidatePath(`/campaigns/${campaignId}`);
      return null;
    });
  }
  ```

- [ ] **Step 3: Create `src/app/(admin)/campaigns/[id]/lead-field-spec-editor.tsx`**

  Same row-editor shape as `IcpCriteriaEditor` (Task 1 — read that file for the pattern: local `Row[]` state, `add`/`update`/`remove` helpers, a `!canEdit` early-return rendering a read-only table, a `save()` that maps rows to the backend input shape and calls the action inside `startTransition`). Columns: field key (text input), label (text input), data type (select from `LEAD_FIELD_DATA_TYPES`), required (checkbox), reject if missing (checkbox), allowed values (optional comma-separated text input, empty means `undefined`), validation pattern (optional text input, empty means `undefined`).

  ```tsx
  "use client";

  import { useState, useTransition } from "react";
  import { toast } from "sonner";
  import { Button } from "@/components/ui/button";
  import { Checkbox } from "@/components/ui/checkbox";
  import { Input } from "@/components/ui/input";
  import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue,
  } from "@/components/ui/select";
  import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
  } from "@/components/ui/table";
  import { setLeadFieldSpecAction } from "./actions";

  type LeadFieldDataType = "string" | "number" | "boolean" | "date" | "email" | "phone" | "url";
  const LEAD_FIELD_DATA_TYPES: LeadFieldDataType[] = ["string", "number", "boolean", "date", "email", "phone", "url"];

  type InitialField = {
    fieldKey: string;
    label: string;
    dataType: LeadFieldDataType;
    isRequired: boolean;
    rejectIfMissing: boolean;
    allowedValues?: unknown[];
    validationPattern?: string;
  };

  type Row = {
    fieldKey: string;
    label: string;
    dataType: LeadFieldDataType;
    isRequired: boolean;
    rejectIfMissing: boolean;
    allowedValuesText: string;
    validationPattern: string;
  };

  type Props = {
    campaignId: string;
    initialFields: InitialField[];
    canEdit: boolean;
  };

  function toRow(field: InitialField): Row {
    return {
      fieldKey: field.fieldKey,
      label: field.label,
      dataType: field.dataType,
      isRequired: field.isRequired,
      rejectIfMissing: field.rejectIfMissing,
      allowedValuesText: (field.allowedValues ?? []).map((v) => String(v)).join(", "),
      validationPattern: field.validationPattern ?? "",
    };
  }

  export function LeadFieldSpecEditor({ campaignId, initialFields, canEdit }: Props) {
    const [pending, startTransition] = useTransition();
    const [rows, setRows] = useState<Row[]>(() => initialFields.map(toRow));

    if (!canEdit) {
      return (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Field key</TableHead>
              <TableHead>Label</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Required</TableHead>
              <TableHead>Reject if missing</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {initialFields.map((field) => (
              <TableRow key={field.fieldKey}>
                <TableCell>{field.fieldKey}</TableCell>
                <TableCell>{field.label}</TableCell>
                <TableCell>{field.dataType}</TableCell>
                <TableCell>{field.isRequired ? "yes" : "no"}</TableCell>
                <TableCell>{field.rejectIfMissing ? "yes" : "no"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      );
    }

    function updateRow(index: number, patch: Partial<Row>) {
      setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    }

    function addRow() {
      setRows((prev) => [
        ...prev,
        { fieldKey: "", label: "", dataType: "string", isRequired: false, rejectIfMissing: false, allowedValuesText: "", validationPattern: "" },
      ]);
    }

    function removeRow(index: number) {
      setRows((prev) => prev.filter((_, i) => i !== index));
    }

    function save() {
      const keys = rows.map((r) => r.fieldKey.trim());
      if (new Set(keys).size !== keys.length) {
        toast.error("Duplicate fieldKey — each field key must be unique");
        return;
      }
      if (keys.some((k) => k === "")) {
        toast.error("Every field needs a field key");
        return;
      }
      const fields = rows.map((row) => ({
        fieldKey: row.fieldKey.trim(),
        label: row.label,
        dataType: row.dataType,
        isRequired: row.isRequired,
        rejectIfMissing: row.rejectIfMissing,
        allowedValues: row.allowedValuesText.trim() === ""
          ? undefined
          : row.allowedValuesText.split(",").map((v) => v.trim()).filter((v) => v !== ""),
        validationPattern: row.validationPattern.trim() === "" ? undefined : row.validationPattern.trim(),
      }));
      startTransition(async () => {
        const result = await setLeadFieldSpecAction(campaignId, fields);
        if (result.ok) {
          toast.success("Lead field spec saved");
        } else {
          toast.error(result.error);
        }
      });
    }

    return (
      <div className="flex flex-col gap-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Field key</TableHead>
              <TableHead>Label</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Required</TableHead>
              <TableHead>Reject if missing</TableHead>
              <TableHead>Allowed values</TableHead>
              <TableHead>Pattern</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, index) => (
              <TableRow key={index}>
                <TableCell>
                  <Input value={row.fieldKey} onChange={(e) => updateRow(index, { fieldKey: e.target.value })} placeholder="job_title" className="w-32" />
                </TableCell>
                <TableCell>
                  <Input value={row.label} onChange={(e) => updateRow(index, { label: e.target.value })} placeholder="Job title" className="w-32" />
                </TableCell>
                <TableCell>
                  <Select value={row.dataType} onValueChange={(value) => updateRow(index, { dataType: value as LeadFieldDataType })}>
                    <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {LEAD_FIELD_DATA_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Checkbox checked={row.isRequired} onCheckedChange={(c) => updateRow(index, { isRequired: c === true })} />
                </TableCell>
                <TableCell>
                  <Checkbox checked={row.rejectIfMissing} onCheckedChange={(c) => updateRow(index, { rejectIfMissing: c === true })} />
                </TableCell>
                <TableCell>
                  <Input value={row.allowedValuesText} onChange={(e) => updateRow(index, { allowedValuesText: e.target.value })} placeholder="optional" className="w-32" />
                </TableCell>
                <TableCell>
                  <Input value={row.validationPattern} onChange={(e) => updateRow(index, { validationPattern: e.target.value })} placeholder="optional regex" className="w-32" />
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="sm" onClick={() => removeRow(index)}>Remove</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex justify-between">
          <Button variant="outline" size="sm" onClick={addRow}>Add field</Button>
          <Button size="sm" disabled={pending} onClick={save}>Save lead field spec</Button>
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 4: Wire into `page.tsx`**

  Add a new `Card` between the ICP criteria card and the Channels card:

  ```tsx
  <Card>
    <CardHeader><CardTitle>Lead field spec</CardTitle></CardHeader>
    <CardContent>
      <LeadFieldSpecEditor
        campaignId={campaign.id}
        initialFields={campaign.leadFieldSpecs.map((f) => ({
          fieldKey: f.fieldKey,
          label: f.label,
          dataType: f.dataType,
          isRequired: f.isRequired,
          rejectIfMissing: f.rejectIfMissing,
          allowedValues: (f.allowedValuesJson as unknown[] | null) ?? undefined,
          validationPattern: f.validationPattern ?? undefined,
        }))}
        canEdit={hasPermission(actor, "campaign:write") && campaign.status === "draft"}
      />
    </CardContent>
  </Card>
  ```

  Add `import { LeadFieldSpecEditor } from "./lead-field-spec-editor";`. `campaign.leadFieldSpecs` is already returned by `getCampaignForActor` (confirmed in the plan's reference section) — no query change needed.

- [ ] **Step 5: Verify**

  `npx tsc --noEmit` clean. Curl-check `/campaigns/<id>` still 200, same session-cookie approach as Task 1.

- [ ] **Step 6: Commit**

  `git add "src/app/(admin)/campaigns/[id]/actions.ts" "src/app/(admin)/campaigns/[id]/lead-field-spec-editor.tsx" "src/app/(admin)/campaigns/[id]/page.tsx"` and commit.

---

## Task 3: Add-channel dialog

**Files:**
- Modify: `src/app/(admin)/campaigns/[id]/actions.ts` (append)
- Create: `src/app/(admin)/campaigns/[id]/add-channel-dialog.tsx`
- Modify: `src/app/(admin)/campaigns/[id]/page.tsx`

**Interfaces:**
- Consumes: `actions.ts` as left by Task 2.
- Produces: `addCampaignChannelAction(campaignId: string, input: { channelTypeId: string; contractedQuantity: number; clientUnitPrice: string; costBudget?: string; startDate: string; endDate: string }): Promise<ActionResult<{ id: string }>>` — note this takes `channelTypeId`, not `channelTypeVersionId`: the action itself resolves the channel type's *current published version* server-side (see Step 2), so the UI never has to know about version rows at all.
- Produces: `AddChannelDialog`, a client component, props `{ campaignId: string; campaignCurrency: string; campaignStartDate: string; campaignEndDate: string; channelTypes: { id: string; name: string; code: string }[] }` (dates as `YYYY-MM-DD` strings, same serialization convention `page.tsx` already uses elsewhere for dates crossing the server/client boundary).

- [ ] **Step 1: Read for context**

  Read the current `page.tsx` and `actions.ts` (as left by Task 2), `src/lib/campaigns/crud.ts`'s `addCampaignChannel` function, and `src/lib/channel-types/versions.ts`'s `getPublishedVersion` function.

- [ ] **Step 2: Append to `actions.ts`**

  This action resolves `channelTypeId` → the channel type's current published `ChannelTypeVersion` row, then calls `addCampaignChannel` with that version's id. If the channel type has no published version (`currentVersion === 0`), that's a `ValidationError` the UI surfaces via the normal `toast.error(result.error)` path — don't special-case it here, `toActionResult` already turns any `ApplicationError` into `{ ok: false, error, code }`.

  ```tsx
  import { addCampaignChannel } from "@/lib/campaigns/crud";
  import { getPublishedVersion } from "@/lib/channel-types/versions";
  import { ValidationError } from "@/lib/errors";
  // (fold these into the existing import blocks at the top of the file rather than adding fresh import statements where a matching one already exists)

  export async function addCampaignChannelAction(
    campaignId: string,
    input: {
      channelTypeId: string;
      contractedQuantity: number;
      clientUnitPrice: string;
      costBudget?: string;
      startDate: string;
      endDate: string;
    },
  ): Promise<ActionResult<{ id: string }>> {
    return toActionResult(async () => {
      const actor = await requireActor();

      const channelType = await db.channelType.findUnique({ where: { id: input.channelTypeId } });
      if (channelType === null) throw new ValidationError("Channel type not found");
      if (channelType.currentVersion === 0) {
        throw new ValidationError(`${channelType.name} has no published version yet`);
      }
      const version = await getPublishedVersion(db, input.channelTypeId, channelType.currentVersion);

      const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });

      const channel = await addCampaignChannel(db, actor, campaignId, {
        channelTypeVersionId: version.id,
        contractedQuantity: input.contractedQuantity,
        clientUnitPrice: input.clientUnitPrice,
        costBudget: input.costBudget,
        currency: campaign.currency,
        startDate: new Date(input.startDate),
        endDate: new Date(input.endDate),
      });
      revalidatePath(`/campaigns/${campaignId}`);
      return { id: channel.id };
    });
  }
  ```

  Note this reads `campaign.currency` from the database rather than trusting a client-supplied currency — `addCampaignChannel` already validates the channel's currency matches the campaign's, so passing anything the client claims would just bounce off that check anyway; reading it server-side avoids a redundant round trip through validation for something that's never legitimately different.

- [ ] **Step 3: Create `src/app/(admin)/campaigns/[id]/add-channel-dialog.tsx`**

  A dialog (same shape as `ApprovalActions`' reject dialog — read that component first) with: a channel-type select, a contracted-quantity number input, a client-unit-price text input (decimal string, e.g. "125.00" — same convention as `new-campaign-form.tsx`'s currency handling, do not parse it as a JS number), an optional cost-budget text input, and start/end date inputs (plain `<Input type="date">`, matching the simple date inputs already used elsewhere in this codebase rather than introducing the calendar-range popover from `new-campaign-form.tsx` — this is a smaller, single-purpose form and doesn't need that). Clamp the date inputs' `min`/`max` to `campaignStartDate`/`campaignEndDate` (HTML `min`/`max` attributes) as a UX hint — the server still enforces the real constraint (`addCampaignChannel` throws `ValidationError` if the window falls outside the campaign's).

  ```tsx
  "use client";

  import { useState, useTransition } from "react";
  import { toast } from "sonner";
  import { Button } from "@/components/ui/button";
  import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
  } from "@/components/ui/dialog";
  import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
  import { Input } from "@/components/ui/input";
  import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue,
  } from "@/components/ui/select";
  import { addCampaignChannelAction } from "./actions";

  type Props = {
    campaignId: string;
    campaignCurrency: string;
    campaignStartDate: string;
    campaignEndDate: string;
    channelTypes: { id: string; name: string; code: string }[];
  };

  export function AddChannelDialog({ campaignId, campaignCurrency, campaignStartDate, campaignEndDate, channelTypes }: Props) {
    const [open, setOpen] = useState(false);
    const [pending, startTransition] = useTransition();
    const [channelTypeId, setChannelTypeId] = useState(channelTypes[0]?.id ?? "");
    const [quantity, setQuantity] = useState("");
    const [unitPrice, setUnitPrice] = useState("");
    const [costBudget, setCostBudget] = useState("");
    const [startDate, setStartDate] = useState(campaignStartDate);
    const [endDate, setEndDate] = useState(campaignEndDate);

    function reset() {
      setQuantity("");
      setUnitPrice("");
      setCostBudget("");
      setStartDate(campaignStartDate);
      setEndDate(campaignEndDate);
    }

    function submit() {
      const contractedQuantity = Number(quantity);
      startTransition(async () => {
        const result = await addCampaignChannelAction(campaignId, {
          channelTypeId,
          contractedQuantity,
          clientUnitPrice: unitPrice,
          costBudget: costBudget.trim() === "" ? undefined : costBudget,
          startDate,
          endDate,
        });
        if (result.ok) {
          toast.success("Channel added");
          reset();
          setOpen(false);
        } else {
          toast.error(result.error);
        }
      });
    }

    const canSubmit =
      channelTypeId !== "" &&
      Number.isFinite(Number(quantity)) && Number(quantity) > 0 &&
      unitPrice.trim() !== "" &&
      startDate !== "" && endDate !== "";

    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size="sm" disabled={channelTypes.length === 0}>Add channel</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader><DialogTitle>Add a channel</DialogTitle></DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="channel-type">Channel type</FieldLabel>
              <Select value={channelTypeId} onValueChange={setChannelTypeId}>
                <SelectTrigger id="channel-type" className="w-full"><SelectValue placeholder="Channel type" /></SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {channelTypes.map((ct) => <SelectItem key={ct.id} value={ct.id}>{ct.name}</SelectItem>)}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="channel-quantity">Contracted quantity</FieldLabel>
              <Input id="channel-quantity" type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="channel-price">Client unit price ({campaignCurrency})</FieldLabel>
              <Input id="channel-price" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} placeholder="e.g. 125.00" />
            </Field>
            <Field>
              <FieldLabel htmlFor="channel-budget">Cost budget ({campaignCurrency}, optional)</FieldLabel>
              <Input id="channel-budget" value={costBudget} onChange={(e) => setCostBudget(e.target.value)} placeholder="optional" />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="channel-start">Start date</FieldLabel>
                <Input id="channel-start" type="date" min={campaignStartDate} max={campaignEndDate} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </Field>
              <Field>
                <FieldLabel htmlFor="channel-end">End date</FieldLabel>
                <Input id="channel-end" type="date" min={campaignStartDate} max={campaignEndDate} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </Field>
            </div>
          </FieldGroup>
          <DialogFooter>
            <Button disabled={pending || !canSubmit} onClick={submit}>Add channel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
  ```

- [ ] **Step 4: Wire into `page.tsx`**

  The Channels `Card`'s `CardHeader` currently has no action slot (just `<CardTitle>Channels</CardTitle>`, no flex/justify-between like the campaigns list page has for its "New campaign" button — check `src/app/(admin)/campaigns/page.tsx` for that exact header pattern and match it). Change it to:

  ```tsx
  <Card>
    <CardHeader className="flex flex-row items-center justify-between">
      <CardTitle>Channels</CardTitle>
      {hasPermission(actor, "campaign:write") && campaign.status === "draft" && (
        <AddChannelDialog
          campaignId={campaign.id}
          campaignCurrency={campaign.currency}
          campaignStartDate={campaign.startDate.toISOString().slice(0, 10)}
          campaignEndDate={campaign.endDate.toISOString().slice(0, 10)}
          channelTypes={channelTypes}
        />
      )}
    </CardHeader>
    <CardContent>
      {/* existing Channels <Table> stays exactly as it is */}
    </CardContent>
  </Card>
  ```

  Add `import { AddChannelDialog } from "./add-channel-dialog";`. Before the `return` statement, fetch the channel types available to pick from — active types that have at least one published version:

  ```tsx
  const channelTypes = await db.channelType.findMany({
    where: { isActive: true, currentVersion: { gt: 0 } },
    select: { id: true, name: true, code: true },
    orderBy: { name: "asc" },
  });
  ```

  Only run this query when it'll actually be used — guard it the same way `campaigns/page.tsx` guards its `clientOrganizations` fetch (`const canCreate = hasPermission(...); const clientOrganizations = canCreate ? await ... : [];`): compute `hasPermission(actor, "campaign:write") && campaign.status === "draft"` once into a local `canAddChannel` and only query `channelTypes` when `canAddChannel` is true, else `[]`.

- [ ] **Step 5: Verify**

  `npx tsc --noEmit` clean. Curl-check `/campaigns/<id>` still 200. If there's a real draft campaign and at least one published channel type in the seeded database (check with `docker compose exec -T postgres psql -U postgres -d console -t -c "select id, name, \"currentVersion\" from \"ChannelType\" where \"isActive\" = true and \"currentVersion\" > 0;"` from the repo root), you can also exercise the full flow end-to-end via curl POSTing to the server action isn't straightforward from curl (Next server actions aren't plain REST endpoints) — so for this task, `tsc` cleanliness plus a visual/structural read of your own diff is the primary gate; note in your report whether a published channel type existed to reference for a sanity check, but don't block on driving the dialog through curl.

- [ ] **Step 6: Commit**

  `git add "src/app/(admin)/campaigns/[id]/actions.ts" "src/app/(admin)/campaigns/[id]/add-channel-dialog.tsx" "src/app/(admin)/campaigns/[id]/page.tsx"` and commit.
