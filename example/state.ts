import { createState, createSelectorHook } from '@state-designer/react'
import { getPointer } from './hooks/useEvents'
import { Mark, ClipboardMessage } from './types'
import getStroke, { StrokeOptions } from 'perfect-freehand'
import polygonClipping from 'polygon-clipping'
import { copyToClipboard } from './utils'

function getSvgPathFromStroke(stroke: number[][]) {
  if (stroke.length === 0) return ''

  const d = []

  let [p0, p1] = stroke

  d.push('M', p0[0], p0[1], 'Q')

  for (let i = 1; i < stroke.length; i++) {
    d.push(p0[0], p0[1], (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2)
    p0 = p1
    p1 = stroke[i]
  }

  d.push('Z')

  return d.join(' ')
}

function getFlatSvgPathFromStroke(stroke: number[][]) {
  const poly = polygonClipping.union([stroke] as any)

  const d = []

  for (let face of poly) {
    for (let points of face) {
      d.push(getSvgPathFromStroke(points))
    }
  }

  return d.join(' ')
}

const easings = {
  linear: (t: number) => t,
  easeIn: (t: number) => t * t,
  easeOut: (t: number) => t * (2 - t),
  easeInOut: (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
}

function getStrokePath(
  points: Mark['points'],
  options: AppOptions,
  type: string
) {
  const stroke = getStroke(points, {
    ...options,
    easing: easings[options.easing],
    simulatePressure: type !== 'pen',
  })

  return options.clip
    ? getFlatSvgPathFromStroke(stroke)
    : getSvgPathFromStroke(stroke)
}

interface AppOptions {
  size: number
  streamline: number
  clip: boolean
  easing: string
  thinning: number
  smoothing: number
  simulatePressure: boolean
}

const defaultOptions: AppOptions = {
  size: 16,
  thinning: 0.75,
  smoothing: 0.5,
  streamline: 0.5,
  simulatePressure: true,
  clip: false,
  easing: 'linear',
}

const defaultSettings = {
  penMode: false,
  darkMode: false,
  showTrace: false,
  showControls: false,
  recomputePaths: true,
}

const state = createState({
  data: {
    settings: { ...defaultSettings },
    alg: { ...defaultOptions },
    restore: [] as { clear?: boolean; marks: Mark[] }[],
    redos: [] as { clear?: boolean; marks: Mark[] }[],
    marks: [] as Mark[],
    currentMark: null as Mark | null,
    clipboardMessage: null as ClipboardMessage | null,
  },
  states: {
    app: {
      initial: 'idle',
      states: {
        idle: {
          on: {
            RESET_OPTIONS: ['resetOptions', 'updatePaths'],
            CHANGED_OPTIONS: ['changeOptions', 'updatePaths'],
            CHANGED_SETTINGS: ['changeSettings'],
            TOGGLED_CONTROLS: 'toggleControls',
            LOADED: ['setup', 'setDarkMode'],
            CLEARED_CANVAS: ['clearMarks'],
            UNLOADED: 'cleanup',
            RESIZED: ['resize'],
            UNDO: ['undoMark'],
            REDO: ['redoMark'],
            TOGGLED_DARK_MODE: ['toggleDarkMode', 'setDarkMode'],
            CLEARED_CLIPBOARD_MESSAGE: 'clearClipboardMessage',
            COPIED_TO_CLIPBOARD: [
              {
                get: 'svgElement',
                if: 'hasResult',
                to: 'copying',
                else: 'alertCouldNotCopyToClipboard',
              },
            ],
            PRESSED_KEY_D: 'toggledTrace',
            PRESSED_KEY_E: ['clearMarks'],
            PRESSED_KEY_Z: [
              { if: ['metaPressed', 'shiftPressed'], do: 'redoMark' },
              { if: 'metaPressed', unless: 'shiftPressed', do: 'undoMark' },
            ],
          },
        },
        copying: {
          async: {
            await: 'copySvgToClipboard',
            onResolve: {
              do: 'alertCopiedToClipboard',
              to: 'idle',
            },
            onReject: {
              do: [
                () => window.alert('no api'),
                'alertCouldNotCopyToClipboard',
              ],
              to: 'idle',
            },
          },
        },
      },
    },
    pointer: {
      initial: 'up',
      states: {
        up: {
          on: {
            DOWNED_POINTER: ['beginMark', { to: 'down' }],
          },
        },
        down: {
          on: {
            LIFTED_POINTER: { do: 'completeMark', to: 'up' },
            MOVED_POINTER: 'addPointToMark',
          },
        },
      },
    },
  },
  onEnter: { do: 'setDarkMode' },
  results: {
    svgElement() {
      return document.getElementById('drawable-svg')
    },
  },
  conditions: {
    hasCurrentMark(data) {
      return !!data.currentMark
    },
    hasResult(data, paylad, result) {
      return !!result
    },
    shiftPressed(data, payload) {
      return payload.keys.shift
    },
    metaPressed(data, payload) {
      return payload.keys.meta
    },
  },
  actions: {
    resetOptions(data) {
      data.alg = { ...defaultOptions }
    },
    changeOptions(data, payload) {
      data.alg = { ...data.alg, ...payload }
    },
    changeSettings(data, payload) {
      data.settings = { ...data.settings, ...payload }
    },
    toggleControls(data) {
      data.settings.showControls = !data.settings.showControls
    },
    toggledTrace(data) {
      data.settings.showTrace = !data.settings.showTrace
    },
    setup(
      data,
      payload: {
        marks: Mark[]
        alg: typeof defaultOptions
        settings: typeof defaultSettings
      }
    ) {
      const { marks, alg, settings } = payload

      data.alg = { ...data.alg, ...alg }

      data.marks = marks.map(mark => ({
        ...mark,
        path: getStrokePath(mark.points, alg, mark.type),
      }))

      data.settings = {
        ...data.settings,
        ...settings,
        penMode: false,
      }
    },
    cleanup(data) {},
    resize(data) {},
    beginMark(data) {
      const { alg } = data
      const { x, y, p, type } = getPointer()
      data.settings.penMode = type === 'pen'

      data.redos = []

      const point = {
        x,
        y,
        pressure: p,
      }

      data.currentMark = {
        type,
        points: [point],
        path: getStrokePath([point], alg, type),
      }
    },
    addPointToMark(data) {
      const { x, y, p, type } = getPointer()
      const { currentMark, alg } = data

      if (type !== currentMark!.type) return

      currentMark!.points.push({
        x,
        y,
        pressure: p,
      })

      currentMark!.path = getStrokePath(
        currentMark!.points,
        alg,
        currentMark!.type
      )
    },
    completeMark(data) {
      const { currentMark, alg } = data

      if (!currentMark) return

      data.marks.push({
        ...currentMark,
        path: getStrokePath(currentMark.points, alg, currentMark!.type),
      })

      data.currentMark = null
    },
    clearMarks(data) {
      data.marks = []
      data.redos = []
    },
    loadData(data, payload: { marks: Mark[] }) {
      const { alg } = data
      data.marks = payload.marks.map(mark => ({
        ...mark,
        path: getStrokePath(mark.points, alg, mark.type),
      }))
    },
    undoMark(data) {
      if (data.marks.length === 0) {
        const restored = data.restore.pop()
        if (restored) data.marks = restored.marks
        return
      }

      const undid = data.marks.pop()
      if (undid) {
        data.redos.push({ marks: [undid] })
      }
    },
    redoMark(data) {
      const undid = data.redos.pop()
      if (undid) {
        data.marks.push(...undid.marks)
      }
    },
    toggleDarkMode(data) {
      data.settings.darkMode = !data.settings.darkMode
    },
    setDarkMode(data) {
      if (typeof document === 'undefined') return

      if (data.settings.darkMode) {
        document.body.classList.add('dark')
      } else {
        document.body.classList.remove('dark')
      }
    },
    updatePaths(data) {
      const { currentMark, alg, marks } = data
      for (let mark of marks) {
        mark.path = getStrokePath(mark.points, alg, mark.type)
      }

      if (currentMark) {
        currentMark.path = getStrokePath(
          currentMark.points,
          alg,
          currentMark.type
        )
      }
    },
    // Clipboard message
    alertCopiedToClipboard(data) {
      data.clipboardMessage = {
        error: false,
        message: `Copied SVG`,
      }
    },
    alertCouldNotCopyToClipboard(data) {
      data.clipboardMessage = {
        error: false,
        message: `Unable to copy SVG.`,
      }
    },
    clearClipboardMessage(data) {
      data.clipboardMessage = null
    },
  },
  asyncs: {
    async copySvgToClipboard(data, payload, result: SVGSVGElement) {
      const element = result
      const padding = 16

      // Get the SVG's bounding box
      const bbox = element.getBBox()
      const tViewBox = element.getAttribute('viewBox')
      const viewBox = [
        bbox.x - padding,
        bbox.y - padding,
        bbox.width + padding * 2,
        bbox.height + padding * 2,
      ].join(' ')

      // Save the original size
      const tW = element.getAttribute('width')
      const tH = element.getAttribute('height')

      // Resize the element to the bounding box
      element.setAttribute('viewBox', viewBox)
      element.setAttribute('width', String(bbox.width))
      element.setAttribute('height', String(bbox.height))

      // Take a snapshot of the element
      const s = new XMLSerializer()
      const svgString = s.serializeToString(element)

      // Reset the element to its original viewBox / size
      element.setAttribute('viewBox', tViewBox)
      element.setAttribute('width', tW)
      element.setAttribute('height', tH)

      // Copy to clipboard!
      try {
        navigator.clipboard.writeText(svgString)
      } catch (e) {
        copyToClipboard(svgString)
      }
    },
  },
})

export const useSelector = createSelectorHook(state)

export default state

// state.onUpdate(d => console.log(d.log[0]))
