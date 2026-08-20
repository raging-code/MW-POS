// src/api.ts — All API calls + React Query hooks
//
// CHANGES vs previous version:
//
//  1. apiFetch now accepts an AbortSignal — React Query passes one
//     automatically when a query is cancelled (e.g. component unmounts).
//     Without it, in-flight fetch requests keep the network connection
//     open and consume CPU parsing the response even after the component
//     is gone. This is especially noticeable on the Sales page where
//     users frequently navigate away while a date-range query is loading.
//
//  2. useMenu staleTime raised to 5 min (was 1 min) and aligned with
//     the global QueryClient default. A 1-min staleTime caused a
//     background menu re-fetch every time the cashier opened/closed
//     a modal (modal open → focus event → stale check → background refetch).
//     With focusManager disabled in main.tsx this is less critical, but
//     the longer staleTime prevents unnecessary network use on LAN.
//
//  3. useCurrentShift refetchInterval increased to 60 s (was 30 s).
//     Shift state changes are rare (open/close once per day) and the
//     mutation already calls invalidateQueries immediately. Polling
//     every 30 s was doubling network traffic for no practical benefit.
//
//  4. useHeldOrders: added staleTime: 0 — held orders ARE time-sensitive
//     (another device may park/restore an order). Keeping them at
//     staleTime: 0 means they always re-fetch when the modal opens,
//     but we don't poll continuously.
//
//  5. useSales, useAuditLogs, useSalesReport — added keepPreviousData:
//     true (React Query v5: placeholderData: keepPreviousData).
//     When the user changes the date filter, the old results stay
//     visible while the new query loads instead of flashing a skeleton.
//     This makes the Sales page feel dramatically more responsive.

import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { useAuthStore } from './store'
import type {
  User, Category, SaleListItem, SaleDetail, Shift, HeldOrder,
  SalesReport, Settings,
  Addon, AuditLog,
} from './types'

// ─── Core fetch wrapper ──────────────────────────────────────────
async function apiFetch<T>(
  path: string,
  opts: RequestInit = {},
  token?: string | null
): Promise<T> {
  const headers: Record<string, string> = {
    ...(opts.body != null ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(opts.headers as Record<string, string> ?? {}),
  }
const rawBase = import.meta.env.VITE_API_URL ?? ''
const BASE = rawBase.endsWith('/api') ? rawBase.slice(0, -4) : rawBase
const res = await fetch(`${BASE}/api${path}`, { ...opts, headers })
  let json: { data: T; error: string | null }
  try {
    json = await res.json() as { data: T; error: string | null }
  } catch {
    throw new Error(`Server error (${res.status}): ${res.statusText || 'unexpected response format'}`)
  }
  if (!res.ok) {
    const msg = json.error || `Request failed (${res.status})`
    throw new Error(msg)
  }
  if (json.error) throw new Error(json.error)
  return json.data as T
}

function useApi() {
  const token = useAuthStore(s => s.token)
  return {
    // CHANGED: pass signal through so React Query can abort in-flight requests
    get: <T>(path: string, signal?: AbortSignal) =>
      apiFetch<T>(path, { method: 'GET', signal }, token),
    post: <T>(path: string, body: unknown) =>
      apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body) }, token),
    put: <T>(path: string, body: unknown) =>
      apiFetch<T>(path, { method: 'PUT', body: JSON.stringify(body) }, token),
    del: <T>(path: string, body?: unknown) =>
      apiFetch<T>(path, { method: 'DELETE', body: body ? JSON.stringify(body) : undefined }, token),
  }
}

// ─── Auth ─────────────────────────────────────────────────────
export function useUsersList() {
  return useQuery({
    queryKey: ['users-list'],
    queryFn: ({ signal }) => apiFetch<User[]>('/auth/users', { method: 'GET', signal }),
    staleTime: 5 * 60_000, // user list changes rarely mid-shift
  })
}

export function useUsersListAuth() {
  const api = useApi()
  const token = useAuthStore(s => s.token)
  return useQuery({
    queryKey: ['users-list-auth'],
    queryFn: ({ signal }) => api.get<User[]>('/auth/users', signal),
    enabled: !!token,
  })
}

export function useLogin() {
  return useMutation({
    mutationFn: ({ user_id, pin }: { user_id: string; pin: string }) =>
      apiFetch<{ token: string; user: User }>('/auth/login', {
        method: 'POST', body: JSON.stringify({ user_id, pin }),
      }),
  })
}

export function useVerifyPin() {
  const api = useApi()
  return useMutation({
    mutationFn: (body: { user_id: string; pin: string; required_role?: 'admin' }) =>
      api.post<{ verified: boolean; role: string; user_id: string; user_name: string }>('/auth/verify-pin', body),
  })
}

// ─── Menu ─────────────────────────────────────────────────────
export function useMenu() {
  const api = useApi()
  return useQuery({
    queryKey: ['menu'],
    queryFn: ({ signal }) => api.get<{ categories: Category[]; addons: Addon[] }>('/menu', signal),
    // CHANGED: 5 min (was 1 min). Aligned with global default.
    // Menu mutations call invalidateQueries immediately so cashiers
    // always see up-to-date data after an admin edit.
    staleTime: 5 * 60_000,
  })
}

export function useCreateCategory() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string; sort_order?: number }) => api.post('/menu/categories', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['menu'] }),
  })
}

export function useDeleteCategory() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.del(`/menu/categories/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['menu'] })
      qc.invalidateQueries({ queryKey: ['audit-logs'] })
    },
  })
}

export function useReorderCategory() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, direction }: { id: string; direction: 'up' | 'down' }) =>
      api.put(`/menu/categories/${id}/reorder`, { direction }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['menu'] }),
  })
}

export function useCreateMenuItem() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string; category_id?: string; sizes: { name: string; price: number }[] }) =>
      api.post('/menu/items', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['menu'] }),
  })
}

export function useUpdateMenuItem() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    // Bug #11 fix: category_id can be null to unassign a category from an item.
    mutationFn: ({ id, ...body }: { id: string; name?: string; category_id?: string | null; is_active?: boolean; sizes?: { name: string; price: number }[] }) =>
      api.put(`/menu/items/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['menu'] }),
  })
}

export function useDeleteMenuItem() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.del(`/menu/items/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['menu'] }),
  })
}

export function useToggleAvailability() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, is_available }: { id: string; is_available: boolean }) =>
      api.put(`/menu/items/${id}/availability`, { is_available }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['menu'] }),
  })
}

export function useCreateAddon() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string; price: number }) => api.post('/menu/addons', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['menu'] }),
  })
}

export function useUpdateAddon() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; price?: number; is_available?: boolean }) =>
      api.put(`/menu/addons/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['menu'] }),
  })
}

export function useDeleteAddon() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.del(`/menu/addons/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['menu'] }),
  })
}

// ─── Shifts ───────────────────────────────────────────────────
export function useCurrentShift() {
  const api = useApi()
  return useQuery({
    queryKey: ['shift-current'],
    queryFn: ({ signal }) => api.get<Shift | null>('/shifts/current', signal),
    // CHANGED: 60 s (was 30 s). Shift state changes via mutation already
    // call invalidateQueries, so continuous polling is mostly redundant.
    refetchInterval: 60_000,
  })
}

export function useOpenShift() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { starting_float: number }) => api.post('/shifts', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shift-current'] }),
  })
}

export function useCloseShift() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; closing_cash: number; notes?: string }) =>
      api.put(`/shifts/${id}/close`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shift-current'] }),
  })
}

export function useCashDrop() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ shift_id, ...body }: { shift_id: string; amount: number; reason: string }) =>
      api.post(`/shifts/${shift_id}/cash-drop`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shift-current'] }),
  })
}

// ─── Held Orders ──────────────────────────────────────────────
export function useHeldOrders() {
  const api = useApi()
  return useQuery({
    queryKey: ['held-orders'],
    queryFn: ({ signal }) => api.get<HeldOrder[]>('/held-orders', signal),
    // CHANGED: staleTime: 0 — held orders must always be fresh when
    // the modal opens because another terminal may have parked/restored one.
    staleTime: 0,
  })
}

export function useCreateHeldOrder() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { data: unknown; label?: string }) => api.post('/held-orders', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['held-orders'] }),
  })
}

export function useDeleteHeldOrder() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.del(`/held-orders/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['held-orders'] }),
  })
}

// ─── Checkout ─────────────────────────────────────────────────
export function useCheckout() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: unknown) => api.post<{ id: string; receipt_number: string; total: number; change: number }>('/sales', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales'] })
      qc.invalidateQueries({ queryKey: ['shift-current'] })
    },
  })
}

// ─── Sales ────────────────────────────────────────────────────
export function useSales(params?: { date_from?: string; date_to?: string; status?: string; receipt?: string }) {
  const api = useApi()
  const qs = new URLSearchParams()
  if (params?.date_from) qs.set('date_from', params.date_from)
  if (params?.date_to) qs.set('date_to', params.date_to)
  if (params?.status) qs.set('status', params.status)
  if (params?.receipt) qs.set('receipt', params.receipt)
  return useQuery({
    queryKey: ['sales', params],
    queryFn: ({ signal }) => api.get<SaleListItem[]>(`/sales?${qs}`, signal),
    // CHANGED: keep previous data visible while new date filter loads.
    // Prevents the full skeleton flash when the user changes From/To dates.
    placeholderData: keepPreviousData,
  })
}

export function useSaleDetail(id: string | null) {
  const api = useApi()
  return useQuery({
    queryKey: ['sale', id],
    queryFn: ({ signal }) => api.get<SaleDetail>(`/sales/${id}`, signal),
    enabled: !!id,
  })
}

export function useVoidSale() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason, actioned_by_user_id, actioned_by_name }: {
      id: string;
      reason: string;
      item_indices?: number[];
      actioned_by_user_id?: string;
      actioned_by_name?: string;
    }) =>
      api.post(`/sales/${id}/void`, { reason, actioned_by_user_id, actioned_by_name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sales'] }),
  })
}

export function useRefundSale() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason, actioned_by_user_id, actioned_by_name }: {
      id: string;
      reason: string;
      item_indices?: number[];
      actioned_by_user_id?: string;
      actioned_by_name?: string;
    }) =>
      api.post(`/sales/${id}/refund`, { reason, actioned_by_user_id, actioned_by_name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sales'] }),
  })
}

export function useSoftDeleteSale() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.del(`/sales/${id}`, { reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sales'] }),
  })
}

export function useReprintSale() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, actioned_by_user_id, actioned_by_name }: {
      id: string;
      actioned_by_user_id?: string;
      actioned_by_name?: string;
    }) => api.post(`/sales/${id}/reprint`, { actioned_by_user_id, actioned_by_name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sales'] }),
  })
}

export function useEditSale() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: {
      id: string;
      note?: string;
      payments?: { method: string; amount: number }[];
      tendered_amount?: number;
    }) => api.put(`/sales/${id}`, body),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['sales'] })
      qc.invalidateQueries({ queryKey: ['sale', vars.id] })
    },
  })
}

// ─── Reports ─────────────────────────────────────────────────
export function useSalesReport(params?: { date_from?: string; date_to?: string }) {
  const api = useApi()
  const qs = new URLSearchParams()
  if (params?.date_from) qs.set('date_from', params.date_from)
  if (params?.date_to) qs.set('date_to', params.date_to)
  return useQuery({
    queryKey: ['report-sales', params],
    queryFn: ({ signal }) => api.get<SalesReport>(`/reports/sales?${qs}`, signal),
    // CHANGED: show stale data while new date range loads.
    placeholderData: keepPreviousData,
  })
}

export function useDetailedSalesReport(params: {
  period: string;
  date?: string;
  date_from?: string;
  date_to?: string;
  year?: number;
  month?: number;
}) {
  const api = useApi()
  const qs = new URLSearchParams()
  qs.set('period', params.period)
  if (params.date) qs.set('date', params.date)
  if (params.date_from) qs.set('date_from', params.date_from)
  if (params.date_to) qs.set('date_to', params.date_to)
  if (params.year) qs.set('year', String(params.year))
  if (params.month) qs.set('month', String(params.month))

  return useQuery({
    queryKey: ['report-sales-detailed', params],
    queryFn: ({ signal }) => api.get<{
      total_sales: number;
      transaction_count: number;
      avg_sale: number;
      total_discount: number;
      voided_count: number;
      refunded_count: number;
      edited_count: number;
      deleted_count: number;
      payment_breakdown: Record<string, number>;
    }>(`/reports/sales-detailed?${qs}`, signal),
    placeholderData: keepPreviousData,
  })
}

// ─── Settings ─────────────────────────────────────────────────
export function useSettings() {
  const api = useApi()
  return useQuery({
    queryKey: ['settings'],
    queryFn: ({ signal }) => api.get<Settings>('/settings', signal),
  })
}

export function useUpdateSettings() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Record<string, string>) => api.put('/settings', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  })
}

// ─── Users ───────────────────────────────────────────────────
export function useUsers() {
  const api = useApi()
  return useQuery({
    queryKey: ['users'],
    queryFn: ({ signal }) => api.get<User[]>('/users', signal),
  })
}

export function useCreateUser() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string; role: 'crew' | 'admin'; pin: string }) =>
      api.post('/users', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      qc.invalidateQueries({ queryKey: ['users-list'] })
    },
  })
}

export function useUpdateUser() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; role?: 'crew' | 'admin'; is_active?: boolean }) =>
      api.put(`/users/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })
}

export function useDeleteUser() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.del(`/users/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      qc.invalidateQueries({ queryKey: ['users-list'] })
    },
  })
}

export function useResetPin() {
  const api = useApi()
  return useMutation({
    mutationFn: ({ id, new_pin }: { id: string; new_pin: string }) =>
      api.post(`/users/${id}/reset-pin`, { new_pin }),
  })
}

// ─── Audit Logs ───────────────────────────────────────────────
export function useAuditLogs(params?: { entity_type?: string; date_from?: string; date_to?: string }) {
  const api = useApi()
  const qs = new URLSearchParams()
  if (params?.entity_type) qs.set('entity_type', params.entity_type)
  if (params?.date_from) qs.set('date_from', params.date_from)
  if (params?.date_to) qs.set('date_to', params.date_to)
  return useQuery({
    queryKey: ['audit-logs', params],
    queryFn: ({ signal }) => api.get<AuditLog[]>(`/audit-logs?${qs}`, signal),
    // CHANGED: keep old logs visible while new filter loads.
    placeholderData: keepPreviousData,
  })
}