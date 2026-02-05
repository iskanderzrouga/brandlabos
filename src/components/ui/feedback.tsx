'use client'

type NoticeTone = 'info' | 'success' | 'error'

type NoticeProps = {
  message: string
  tone?: NoticeTone
  onDismiss?: () => void
}

type ConfirmDialogProps = {
  open: boolean
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'default' | 'danger'
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

const toneClass: Record<NoticeTone, string> = {
  info: 'border-[var(--editor-border)] bg-[var(--editor-panel-muted)] text-[var(--editor-ink)]',
  success:
    'border-[rgba(42,157,143,0.35)] bg-[rgba(42,157,143,0.12)] text-[var(--editor-accent-strong)]',
  error: 'border-[rgba(181,56,56,0.35)] bg-[rgba(181,56,56,0.1)] text-[rgb(132,29,29)]',
}

export function FeedbackNotice({ message, tone = 'info', onDismiss }: NoticeProps) {
  return (
    <div
      className={`rounded-xl border px-3 py-2 text-xs flex items-start justify-between gap-3 ${toneClass[tone]}`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <span>{message}</span>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="text-[11px] underline underline-offset-4"
        >
          Dismiss
        </button>
      ) : null}
    </div>
  )
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/35 backdrop-blur-sm" onClick={onCancel} />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl border border-[var(--editor-border)] bg-[var(--editor-panel)] p-5 shadow-[0_24px_56px_-28px_var(--editor-shadow)]">
          <h2 className="text-base font-semibold text-[var(--editor-ink)]">{title}</h2>
          {description ? (
            <p className="text-sm text-[var(--editor-ink-muted)] mt-2">{description}</p>
          ) : null}
          <div className="mt-5 flex items-center justify-end gap-2">
            <button type="button" onClick={onCancel} className="editor-button-ghost text-xs">
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              className={`editor-button text-xs ${
                tone === 'danger' ? 'bg-[rgb(166,47,47)] hover:bg-[rgb(146,40,40)]' : ''
              }`}
            >
              {busy ? 'Working...' : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
