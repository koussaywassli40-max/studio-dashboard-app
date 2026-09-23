
import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import './App.css'

const initialFiles = [
  { name: 'PHYSICS 101', type: 'folder', color: 'blue' },
  { name: 'Quantum.pdf', type: 'pdf', color: 'red' },
  { name: 'WWII Essay', type: 'folder', color: 'blue' },
  { name: 'Draft.pdf', type: 'pdf', color: 'red' },
]

const subjectTree = [
  {
    label: 'PHYSICS 101',
    color: 'blue',
    items: ['Chapter 1', 'Chapter 2'],
    status: ['High Priority', 'Exam Due'],
  },
  {
    label: 'HISTORY',
    color: 'gold',
    items: ['World War I', 'The Cold War', 'Decolonization'],
    status: ['Review Needed'],
  },
  {
    label: 'COMPUTER SCIENCE',
    color: 'green',
    items: ['Algorithms', 'Data Structures', 'Databases'],
    status: ['Complete', 'Complete'],
  },
  {
    label: 'MATHEMATICS',
    color: 'purple',
    items: ['Calculus', 'Linear Algebra', 'Discrete Math'],
    status: ['Complete'],
  },
]

const API_BASE_URL = (() => {
  if (typeof window === 'undefined') return 'http://localhost:3004'

  const host = window.location.hostname
  if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') {
    return 'http://localhost:3004'
  }

  return window.location.origin
})()

const makeConversation = (title = 'New conversation', messages = []) => ({
  id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  title,
  messages,
})

const normalizeMathDelimiters = (text) => text
  .replace(/\\\[([\s\S]*?)\\\]/g, '$$$1$$')
  .replace(/\\\(([\s\S]*?)\\\)/g, '$$$1$')

const getStoredConversations = () => {
  if (typeof window === 'undefined') {
    return [makeConversation('New conversation', [{ role: 'assistant', text: 'I am ready to help with your academic notes, summaries, and study questions.' }])]
  }

  try {
    const saved = localStorage.getItem('studio-conversations')
    if (!saved) {
      return [makeConversation('New conversation', [{ role: 'assistant', text: 'I am ready to help with your academic notes, summaries, and study questions.' }])]
    }

    const parsed = JSON.parse(saved)
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed
    }
  } catch {
    // Ignore parse errors and fall back to a fresh conversation.
  }

  return [makeConversation('New conversation', [{ role: 'assistant', text: 'I am ready to help with your academic notes, summaries, and study questions.' }])]
}

export default function App() {
  const [isLightMode, setIsLightMode] = useState(false)
  const [isFocusMode, setIsFocusMode] = useState(false)
  const [files, setFiles] = useState(initialFiles)
  const [fileContents, setFileContents] = useState([])
  const [draggedName, setDraggedName] = useState('')
  const [isDropActive, setIsDropActive] = useState(false)
  const [conversations, setConversations] = useState(() => getStoredConversations())
  const [activeConversationId, setActiveConversationId] = useState(() => {
    if (typeof window === 'undefined') return null

    const saved = localStorage.getItem('studio-active-conversation-id')
    return saved || null
  })
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isPdfFullscreen, setIsPdfFullscreen] = useState(false)
  const [selectedStudyTarget, setSelectedStudyTarget] = useState('Quantum.pdf')

  const activeConversation = conversations.find((conversation) => conversation.id === (activeConversationId || conversations[0]?.id)) || conversations[0]
  const messages = activeConversation?.messages || []

  const updateActiveConversation = (updater) => {
    setConversations((currentConversations) =>
      currentConversations.map((conversation) => {
        if (conversation.id !== (activeConversationId || currentConversations[0]?.id)) {
          return conversation
        }

        return {
          ...conversation,
          messages: typeof updater === 'function' ? updater(conversation.messages) : updater,
        }
      }),
    )
  }

  const getConversationTitle = (conversationMessages) => {
    const firstUserMessage = conversationMessages.find((message) => message.role === 'user')
    if (!firstUserMessage) return 'New conversation'

    const trimmed = firstUserMessage.text.trim()
    return trimmed.length > 24 ? `${trimmed.slice(0, 24).trim()}...` : trimmed
  }

  const createConversation = () => {
    const nextConversation = makeConversation('New conversation', [{
      role: 'assistant',
      text: 'I am ready to help with your academic notes, summaries, and study questions.',
    }])

    setConversations((currentConversations) => [nextConversation, ...currentConversations])
    setActiveConversationId(nextConversation.id)
  }

  const saveCurrentConversation = () => {
    setConversations((currentConversations) =>
      currentConversations.map((conversation) => {
        if (conversation.id !== (activeConversationId || currentConversations[0]?.id)) {
          return conversation
        }

        return {
          ...conversation,
          title: getConversationTitle(conversation.messages) || 'New conversation',
        }
      }),
    )
  }

  const deleteConversation = (conversationId) => {
    setConversations((currentConversations) => {
      if (currentConversations.length === 1) {
        const replacement = makeConversation('New conversation', [{
          role: 'assistant',
          text: 'I am ready to help with your academic notes, summaries, and study questions.',
        }])
        setActiveConversationId(replacement.id)
        return [replacement]
      }

      const remaining = currentConversations.filter((conversation) => conversation.id !== conversationId)
      const nextActive = remaining[0]
      setActiveConversationId(nextActive.id)
      return remaining
    })
  }

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('studio-conversations', JSON.stringify(conversations))
      if (activeConversationId) {
        localStorage.setItem('studio-active-conversation-id', activeConversationId)
      }
    }
  }, [conversations, activeConversationId])

  const readFileAsBase64 = async (file) => {
    const bytes = new Uint8Array(await file.arrayBuffer())
    let binary = ''
    const chunkSize = 8192

    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
    }

    return btoa(binary)
  }

  const addFilesToLibrary = async (incomingFiles) => {
    const nextFiles = [...files]
    const readableFiles = []

    for (const file of incomingFiles) {
      const normalizedName = file.name.trim()
      if (!normalizedName) continue

      const exists = nextFiles.some((item) => item.name === normalizedName)
      if (exists) continue

      nextFiles.push({
        name: normalizedName,
        type: normalizedName.toLowerCase().endsWith('.pdf') ? 'pdf' : 'folder',
        color: normalizedName.toLowerCase().endsWith('.pdf') ? 'red' : 'blue',
      })

      if (file.type.startsWith('text/') || /\.(txt|md|csv|json|js|jsx|ts|tsx|html|css)$/i.test(normalizedName)) {
        readableFiles.push({
          name: normalizedName,
          text: (await file.text()).slice(0, 12000),
        })
      } else if (file.type === 'application/pdf' || normalizedName.toLowerCase().endsWith('.pdf')) {
        readableFiles.push({
          name: normalizedName,
          pdfBase64: await readFileAsBase64(file),
        })
      }
    }

    setFiles(nextFiles)
    if (readableFiles.length > 0) {
      setFileContents((current) => [
        ...current.filter((item) => !readableFiles.some((file) => file.name === item.name)),
        ...readableFiles,
      ])
    }
  }

  const moveFileToIndex = (sourceName, targetIndex) => {
    if (!sourceName) return

    setFiles((currentFiles) => {
      const sourceIndex = currentFiles.findIndex((file) => file.name === sourceName)
      const safeTargetIndex = Math.max(0, Math.min(targetIndex, currentFiles.length - 1))

      if (sourceIndex === -1 || sourceIndex === safeTargetIndex) return currentFiles

      const nextFiles = [...currentFiles]
      const [movedFile] = nextFiles.splice(sourceIndex, 1)
      const adjustedIndex = sourceIndex < safeTargetIndex ? safeTargetIndex - 1 : safeTargetIndex
      nextFiles.splice(Math.max(0, adjustedIndex), 0, movedFile)
      return nextFiles
    })
  }

  const handleDrop = (event) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDropActive(false)

    const sourceName = event.dataTransfer.getData('text/plain') || draggedName
    const droppedFiles = Array.from(event.dataTransfer.files || [])
    const targetIndex = Number(event.currentTarget.dataset.index ?? files.length)

    if (sourceName) {
      if (targetIndex < files.length) {
        moveFileToIndex(sourceName, targetIndex)
      } else {
        setFiles((currentFiles) => {
          const sourceIndex = currentFiles.findIndex((file) => file.name === sourceName)
          if (sourceIndex === -1) return currentFiles
          const nextFiles = [...currentFiles]
          const [movedFile] = nextFiles.splice(sourceIndex, 1)
          nextFiles.push(movedFile)
          return nextFiles
        })
      }
    }

    if (droppedFiles.length > 0) {
      addFilesToLibrary(droppedFiles)
    }

    setDraggedName('')
  }

  const handleDragStart = (event, name) => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', name)
    setDraggedName(name)
  }

  const buildDashboardContext = () => {
    const fileSummary = files
      .map((file) => `${file.name} (${file.type === 'pdf' ? 'PDF document' : 'folder'})`)
      .join('\n')

    const subjectSummary = subjectTree
      .map((section) => `${section.label}: ${section.items.join(', ')} — ${section.status.join(', ')}`)
      .join('\n')

    return [
      'Current dashboard context:',
      `Current user focus: ${selectedStudyTarget || 'No item selected yet.'}`,
      'Academic files in the library:',
      fileSummary || 'No files in the library yet.',
      '',
      'Subject index:',
      subjectSummary || 'No subject index entries available.',
    ].join('\n')
  }

  const sendPromptToAssistant = async (text) => {
    const asksAboutFiles = /file|pdf|document|notes?|chapter|page|uploaded|dropped|study material/i.test(text)
    const relevantFiles = fileContents.filter((file) => !file.pdfBase64 || asksAboutFiles)
    const dashboardContext = buildDashboardContext()
    const response = await fetch(`${API_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: text,
        files: relevantFiles,
        dashboardContext,
        conversationHistory: messages.slice(-12),
      }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.error || `Assistant request failed: ${response.status}`)
    }

    const result = await response.json()
    updateActiveConversation((currentMessages) => [
      ...currentMessages,
      { role: 'assistant', text: result.reply },
    ])
  }

  const handleSend = async () => {
    const trimmed = input.trim()
    if (!trimmed || isLoading) return

    updateActiveConversation((currentMessages) => {
      const nextMessages = [...currentMessages, { role: 'user', text: trimmed }]
      return nextMessages
    })
    setInput('')
    setIsLoading(true)

    try {
      await sendPromptToAssistant(trimmed)
      setConversations((currentConversations) =>
        currentConversations.map((conversation) => {
          if (conversation.id !== (activeConversationId || currentConversations[0]?.id)) {
            return conversation
          }

          return {
            ...conversation,
            title: getConversationTitle(conversation.messages),
          }
        }),
      )
    } catch (error) {
      updateActiveConversation((currentMessages) => [
        ...currentMessages,
        {
          role: 'assistant',
          text: 'The study assistant is unavailable right now. Please make sure the app server is running and try again.',
        },
      ])
      console.error(error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className={`studio-app ${isLightMode ? 'light' : 'dark'}`}>
      <div className="monitor-wrap">
        <div className="monitor-window">
          <div className="window-bar">
            <div className="traffic-lights">
              <span className="dot red" />
              <span className="dot yellow" />
              <span className="dot green" />
            </div>

            <div className="window-title">STUDIO DASHBOARD</div>

            <div className="toolbar-controls">
              <button
                type="button"
                className={`toolbar-btn focus-btn ${isFocusMode ? 'active' : ''}`}
                onClick={() => setIsFocusMode(!isFocusMode)}
              >
                <span className="toggle-indicator" />
                FOCUS MODE {isFocusMode ? 'ON' : 'OFF'}
              </button>

              <button
                type="button"
                className="toolbar-btn theme-btn"
                onClick={() => setIsLightMode(!isLightMode)}
              >
                <span className="theme-emoji">{isLightMode ? '🌙' : '☀️'}</span>
                {isLightMode ? 'Dark Mode' : 'Light Mode'}
              </button>
            </div>
          </div>

          <div className="dashboard-grid">
            <div
              className={`panel file-panel ${isDropActive ? 'drop-active' : ''}`}
              onDragOver={(event) => {
                event.preventDefault()
                setIsDropActive(true)
              }}
              onDragLeave={() => setIsDropActive(false)}
              onDrop={handleDrop}
            >
              <h2>YOUR ACADEMIC FILES</h2>

              <div className="file-row">
                {files.map((file, index) => (
                  <div
                    key={file.name}
                    className={`file-item ${selectedStudyTarget === file.name ? 'selected' : ''}`}
                    draggable
                    data-index={index}
                    onClick={() => setSelectedStudyTarget(file.name)}
                    onDragOver={(event) => {
                      event.preventDefault()
                      setIsDropActive(true)
                    }}
                    onDrop={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      const targetIndex = Number(event.currentTarget.dataset.index ?? files.length)
                      const sourceName = event.dataTransfer.getData('text/plain') || draggedName

                      if (sourceName) {
                        moveFileToIndex(sourceName, targetIndex)
                      }

                      setDraggedName('')
                      setIsDropActive(false)
                    }}
                    onDragStart={(event) => handleDragStart(event, file.name)}
                    onDragEnd={() => {
                      setDraggedName('')
                      setIsDropActive(false)
                    }}
                  >
                    <div className={`file-icon ${file.color}`}>{file.type === 'pdf' ? 'PDF' : '📁'}</div>
                    <span>{file.name}</span>
                  </div>
                ))}
              </div>

              <div
                className={`drop-zone ${isDropActive ? 'active' : ''}`}
                data-index={files.length}
                onDragOver={(event) => {
                  event.preventDefault()
                  setIsDropActive(true)
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  const targetIndex = Number(event.currentTarget.dataset.index ?? files.length)
                  const sourceName = event.dataTransfer.getData('text/plain') || draggedName

                  if (sourceName) {
                    moveFileToIndex(sourceName, targetIndex)
                  }

                  setDraggedName('')
                  setIsDropActive(false)
                }}
              >
                {draggedName ? `📥 Drop ${draggedName} to Index` : '📥 Drag & Drop to Index'}
              </div>
            </div>

            {!isFocusMode && (
              <div className="panel index-panel">
                <h2>CHAPTER &amp; SUBJECT INDEX</h2>

                <div className="index-tree">
                  {subjectTree.map((section) => (
                    <div className="tree-group" key={section.label}>
                      <div className={`tree-header ${section.color}`}>
                        <span className="tree-label">📂 {section.label}</span>
                      </div>

                      <div className="tree-items">
                        {section.items.map((item, idx) => (
                          <div
                            className={`tree-row ${selectedStudyTarget === `${section.label} - ${item}` ? 'selected' : ''}`}
                            key={item}
                            onClick={() => setSelectedStudyTarget(`${section.label} - ${item}`)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault()
                                setSelectedStudyTarget(`${section.label} - ${item}`)
                              }
                            }}
                          >
                            <span className="branch">└─</span>
                            <span className="item-name">{item}</span>
                            {section.status[idx] && (
                              <span className={`status-pill ${section.color}`}>
                                {section.status[idx]}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className={`panel assistant-panel ${isFocusMode ? 'wide' : ''}`}>
              <h2>STUDY ASSISTANT</h2>

              <div className="chat-layout">
                <aside className="chat-sidebar">
                  <div className="chat-sidebar-actions">
                    <button type="button" onClick={createConversation} className="sidebar-action primary">
                      + New chat
                    </button>
                    <button type="button" onClick={saveCurrentConversation} className="sidebar-action">
                      Save
                    </button>
                  </div>

                  <div className="conversation-list">
                    {conversations.map((conversation) => (
                      <div
                        key={conversation.id}
                        className={`conversation-item ${conversation.id === activeConversationId ? 'active' : ''}`}
                      >
                        <button
                          type="button"
                          className="conversation-select"
                          onClick={() => setActiveConversationId(conversation.id)}
                        >
                          {conversation.title}
                        </button>
                        <button
                          type="button"
                          className="conversation-delete"
                          onClick={() => deleteConversation(conversation.id)}
                          aria-label={`Delete ${conversation.title}`}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </aside>

                <div className="chat-main">
                  <div className="chat-box">
                    {messages.map((message, index) => (
                      <div
                        key={`${message.role}-${index}`}
                        className={`chat-bubble ${message.role === 'user' ? 'user' : 'ai'}`}
                      >
                        {message.role === 'assistant' ? (
                          <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                            {normalizeMathDelimiters(message.text)}
                          </ReactMarkdown>
                        ) : (
                          message.text
                        )}
                      </div>
                    ))}
                    {isLoading && <div className="chat-bubble ai loading">Thinking…</div>}
                  </div>

                  <form
                    className="assistant-input-row"
                    onSubmit={(event) => {
                      event.preventDefault()
                      handleSend()
                    }}
                  >
                    <input
                      type="text"
                      value={input}
                      onChange={(event) => setInput(event.target.value)}
                      placeholder="Ask a question about your files..."
                    />
                    <button
                      type="submit"
                      onClick={(event) => {
                        event.preventDefault()
                        handleSend()
                      }}
                      disabled={isLoading}
                    >
                      {isLoading ? 'Sending…' : 'Send'}
                    </button>
                  </form>
                </div>
              </div>
            </div>

            {!isFocusMode && (
              <div className={`panel pdf-panel ${isPdfFullscreen ? 'fullscreen' : ''}`}>
                <div className="panel-header">
                  <h2>PDF READER</h2>
                  <button
                    type="button"
                    className="pdf-fullscreen-btn"
                    onClick={() => setIsPdfFullscreen((current) => !current)}
                  >
                    {isPdfFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                  </button>
                </div>

                <div className="pdf-reader">
                  <div className="pdf-toolbar">
                    <span className="pdf-file-name">Quantum.pdf</span>
                    <div className="pdf-tools">
                      <span>100%</span>
                      <span>Page 1</span>
                    </div>
                  </div>

                  <div className="pdf-document">
                    <div className="pdf-page">
                      <div className="page-header">Quantum Mechanics</div>
                      <h3>Fundamental Principles</h3>
                      <p>
                        Quantum mechanics describes the behavior of matter and energy at microscopic scales.
                        It introduces uncertainty, wave-particle duality, and quantized energy levels.
                      </p>
                      <ul>
                        <li>Particles behave like waves under certain conditions.</li>
                        <li>Energy levels are discrete, not continuous.</li>
                        <li>Observation affects the measured state of a system.</li>
                      </ul>
                      <div className="equation-box">E = hν</div>
                      <p>
                        In practice, this changes how we model physical systems and helps explain atomic structure,
                        spectra, and subatomic interactions.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
