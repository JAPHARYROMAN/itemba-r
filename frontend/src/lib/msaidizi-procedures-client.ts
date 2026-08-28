/**
 * The procedures API, as the browser reaches it.
 *
 * Every call goes through the same proxy the rest of the app uses, so a
 * procedure screen is subject to exactly the guards a direct API caller is.
 * Nothing here decides authority: `compile` returns what the CALLER may reach,
 * `activate` is refused server-side for the author, and a run is bounded by the
 * invoker's own permissions. The UI renders those answers; it never anticipates
 * them.
 */

import { backendGet, backendList, backendPatch, backendPost } from './api-client';
import type {
  CreateMsaidiziProcedureRequest,
  MsaidiziCompiledProcedure,
  MsaidiziProcedure,
} from './msaidizi-procedure-types';

const procedurePath = (id: string) => `/msaidizi/procedures/${encodeURIComponent(id)}`;

export function listMsaidiziProcedures(companyId?: string): Promise<MsaidiziProcedure[]> {
  const query = companyId ? `?companyId=${encodeURIComponent(companyId)}` : '';
  return backendList<MsaidiziProcedure>(`/msaidizi/procedures${query}`);
}

export function fetchMsaidiziProcedure(id: string): Promise<MsaidiziProcedure> {
  return backendGet<MsaidiziProcedure>(procedurePath(id));
}

/**
 * Resolves an instruction to the capabilities a run would be allowed to use.
 * Saves nothing — this is the review step, and the author is expected to read
 * the result before creating anything.
 */
export function compileMsaidiziProcedure(instruction: string): Promise<MsaidiziCompiledProcedure> {
  return backendPost<MsaidiziCompiledProcedure>('/msaidizi/procedures/compile', { instruction });
}

export function createMsaidiziProcedure(
  request: CreateMsaidiziProcedureRequest,
): Promise<MsaidiziProcedure> {
  return backendPost<MsaidiziProcedure>('/msaidizi/procedures', request);
}

/**
 * Approves a procedure for use. Separate from creation deliberately, and
 * refused server-side when the approver is the author — maker-checker is the
 * only review step a procedure gets.
 */
export function activateMsaidiziProcedure(id: string): Promise<MsaidiziProcedure> {
  return backendPatch<MsaidiziProcedure>(`${procedurePath(id)}/activate`);
}

/**
 * Retires a procedure. There is no delete: the API archives, and an archived
 * procedure cannot be reactivated, so the UI must not offer deletion as though
 * one existed.
 */
export function archiveMsaidiziProcedure(id: string): Promise<MsaidiziProcedure> {
  return backendPatch<MsaidiziProcedure>(`${procedurePath(id)}/archive`);
}
