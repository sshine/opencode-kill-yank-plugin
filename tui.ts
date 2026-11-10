import { Plugin } from "@opencode/plugin/tui"
import {
  TextareaRenderable,
  createClipboard,
  createHostClipboard,
  createRendererClipboardAdapter,
  decodePasteBytes,
  type EditBufferRenderable,
} from "@opentui/core"

/**
 * Readline/Emacs-style kill + yank for the prompt and every other textarea.
 *
 * ctrl+u  kill from the cursor to the start of the line (or kill the selection)
 * ctrl+k  kill from the cursor to the end of the line (or kill the selection)
 * ctrl+y  yank the last killed text
 *
 * Killed text is also written to the system clipboard and to the terminal via
 * OSC 52. Yank prefers the in-process kill buffer so it still works instantly
 * when the system clipboard is unavailable (for example over SSH).
 */
export default Plugin.define({
  id: "local.emacs-kill-yank",
  setup(context) {
    const clipboard = createClipboard({
      host: createHostClipboard(),
      terminal: createRendererClipboardAdapter(context.renderer),
    })

    let kill = ""

    const focused = (): EditBufferRenderable | undefined => {
      const editor = context.renderer.currentFocusedEditor
      return editor instanceof TextareaRenderable ? editor : undefined
    }

    const remember = (text: string) => {
      if (!text) return
      kill = text
      void clipboard
        .writeText(text.replaceAll("\0", ""), {
          destination: "all-available",
          selection: "clipboard",
        })
        .catch(() => {
          // The in-process kill buffer still works if no clipboard is available.
        })
    }

    const killToStart = (editor: EditBufferRenderable) => {
      if (editor.getSelection()) {
        remember(editor.getSelectedText())
        editor.deleteChar()
        return
      }

      const cursor = editor.editorView.getCursor()
      remember(
        cursor.col > 0
          ? editor.getTextRangeByCoords(cursor.row, 0, cursor.row, cursor.col)
          : cursor.row > 0
            ? "\n"
            : "",
      )
      editor.deleteToLineStart()
    }

    const killToEnd = (editor: EditBufferRenderable) => {
      if (editor.getSelection()) {
        remember(editor.getSelectedText())
        editor.deleteChar()
        return
      }

      const cursor = editor.editorView.getCursor()
      const eol = editor.editBuffer.getEOL()
      remember(
        eol.row === cursor.row && eol.col > cursor.col
          ? editor.getTextRangeByCoords(cursor.row, cursor.col, eol.row, eol.col)
          : "",
      )
      editor.deleteToLineEnd()
    }

    const yank = async (editor: EditBufferRenderable) => {
      let text = kill

      if (!text) {
        const result = await clipboard.read({
          preferredTypes: ["text/plain"],
          selection: "clipboard",
        })
        if (result.status === "read" && result.representation.mimeType === "text/plain") {
          text = decodePasteBytes(result.representation.bytes)
        }
      }

      if (!text) return
      editor.insertText(text)
    }

    context.keymap.layer(() => ({
      mode: "global",
      priority: 10,
      target: () => context.renderer.currentFocusedEditor,
      commands: [
        {
          id: "local.emacs.kill-to-line-start",
          title: "Kill to start of line",
          bind: "ctrl+u",
          enabled: () => focused() !== undefined,
          run: (_input, event) => {
            const editor = focused()
            if (!editor) return false
            event?.preventDefault()
            event?.stopPropagation()
            killToStart(editor)
          },
        },
        {
          id: "local.emacs.kill-to-line-end",
          title: "Kill to end of line",
          bind: "ctrl+k",
          enabled: () => focused() !== undefined,
          run: (_input, event) => {
            const editor = focused()
            if (!editor) return false
            event?.preventDefault()
            event?.stopPropagation()
            killToEnd(editor)
          },
        },
        {
          id: "local.emacs.yank",
          title: "Yank",
          bind: "ctrl+y",
          enabled: () => focused() !== undefined,
          run: async (_input, event) => {
            const editor = focused()
            if (!editor) return
            event?.preventDefault()
            event?.stopPropagation()
            await yank(editor)
          },
        },
      ],
    }))

    return () => {
      void clipboard.dispose()
    }
  },
})
