// src/api.ts — All API calls + React Query hooks

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
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
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(opts.headers as Record<string, string> ?? {}),
  }
  const BASE = import.meta.env.VITE_API_URL ?? ''
const res = await fetch(`${BASE}/api${path}`, { ...opts, headers })
  const json = await res.json() as { data: T; error: string | null }
  if (json.error) throw new Error(json.error)
  return json.data as T
}

function useApi() {
  const token = useAuthStore(s => s.token)
  return {
    get: <T>(path: string) => apiFetch<T>(path, { method: 'GET' }, token),
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
    queryFn: () => apiFetch<User[]>('/auth/users'),
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
      api.post<{ verified: boolean; role: string }>('/auth/verify-pin', body),
  })
}

// ─── Menu ─────────────────────────────────────────────────────
export function useMenu() {
  const api = useApi()
  return useQuery({
    queryKey: ['menu'],
    queryFn: () => api.get<{ categories: Category[]; addons: Addon[] }>('/menu'),
    staleTime: 1000 * 60,
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
    mutationFn: ({ id, ...body }: { id: string; name?: string; category_id?: string; is_active?: boolean; sizes?: { name: string; price: number }[] }) =>
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

// ─── Shifts ───────────────────────────────────────────────────
export function useCurrentShift() {
  const api = useApi()
  return useQuery({
    queryKey: ['shift-current'],
    queryFn: () => api.get<Shift | null>('/shifts/current'),
    refetchInterval: 30_000,
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
    queryFn: () => api.get<HeldOrder[]>('/held-orders'),
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
    queryFn: () => api.get<SaleListItem[]>(`/sales?${qs}`),
  })
}

export function useSaleDetail(id: string | null) {
  const api = useApi()
  return useQuery({
    queryKey: ['sale', id],
    queryFn: () => api.get<SaleDetail>(`/sales/${id}`),
    enabled: !!id,
  })
}

export function useVoidSale() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/sales/${id}/void`, { reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sales'] }),
  })
}

export function useRefundSale() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/sales/${id}/refund`, { reason }),
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
    mutationFn: (id: string) => api.post(`/sales/${id}/reprint`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sales'] }),
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
    queryFn: () => api.get<SalesReport>(`/reports/sales?${qs}`),
  })
}

// ─── Settings ─────────────────────────────────────────────────
export function useSettings() {
  const api = useApi()
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<Settings>('/settings'),
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
    queryFn: () => api.get<User[]>('/users'),
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
    queryFn: () => api.get<AuditLog[]>(`/audit-logs?${qs}`),
  })
}