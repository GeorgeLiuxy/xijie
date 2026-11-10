import { isZh, useI18n } from './i18n'
import type { Memory } from './model'
import { ContextSheet } from './mobile/ContextSheet'
import { I } from './ui'
import './memory-reader.css'

export function MemoryReader({ memory, personName, onClose }: { memory: Memory; personName: string; onClose: () => void }) {
  const { t, lang } = useI18n()
  const label = isZh(lang) ? '回忆原文' : 'Original memory'
  return <ContextSheet label={label} onClose={onClose} className="memory-reader-sheet">
    <header className="memory-reader-heading">
      <h2>{label}</h2>
      <button data-context-close onClick={onClose} aria-label={t('common.close')}><I.X /></button>
    </header>
    <article className="memory-reader-content">
      <p>{personName}</p>
      <h3>{memory.title}</h3>
      {memory.body && <p className="memory-reader-original">{memory.body}</p>}
    </article>
  </ContextSheet>
}
