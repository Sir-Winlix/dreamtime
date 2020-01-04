// DreamTime.
// Copyright (C) DreamNet. All rights reserved.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License 3.0 as published by
// the Free Software Foundation. See <https://www.gnu.org/licenses/gpl-3.0.html>
//
// Written by Ivan Bravo Bravo <ivan@dreamnet.tech>, 2019.

import {
  cloneDeep, isNil, merge, isError,
} from 'lodash'
import Queue from 'better-queue'
import MemoryStore from 'better-queue-memory'
import EventBus from 'js-event-bus'
import { settings } from '../system'
import { Consola, handleError } from '../consola'
import { Nudify } from './nudify'
import { PhotoRun } from './photo-run'
import { File } from '../file'
import { Timer } from '../timer'

const { getCurrentWindow } = require('electron').remote

const { getModelsPath, getCropPath } = $provider.paths

export class Photo {
  /**
   * @type {string}
   */
  id

  /**
   * @type {File}
   */
  file

  /**
   * @type {File}
   */
  fileEditor

  /**
   * @type {File}
   */
  fileCrop

  /**
   * @type {EventBus}
   */
  events = new EventBus

  /**
   * @type {string}
   */
  model

  /**
   * @type {string}
   */
  _status = 'pending'

  get status() {
    return this._status
  }

  set status(value) {
    this._status = value
    Nudify.emitUpdate()
  }

  /**
   * @type {Queue}
   */
  queue

  /**
   * @type {Array}
   */
  runs = []

  /**
   * @type {Object}
   */
  preferences = {}

  /**
   * @type {Timer}
   */
  timer = new Timer

  /**
   * @type {require('cropperjs').default}
   */
  cropper

  /**
   * @type {require('tui-image-editor').default}
   */
  editor

  /**
   * @type {Object}
   */
  overlay = {
    startX: 0,
    startY: 0,
    endX: 0,
    endY: 0,
  }

  /**
   * @type {Consola}
   */
  consola

  get folderName() {
    // todo: implement models
    return 'Uncategorized'
  }

  get running() {
    return this._status === 'running'
  }

  get finished() {
    return this._status === 'finished'
  }

  get pending() {
    return this._status === 'pending'
  }

  get waiting() {
    return this._status === 'waiting'
  }

  get started() {
    return this.running || this.finished
  }

  get canModify() {
    return this.file.mimetype !== 'image/gif'
  }

  get scaleMode() {
    const { scaleMode } = this.preferences.advanced

    if (scaleMode === 'cropjs' && !this.fileCrop.exists) {
      // no crop, automatically rescale for convenience
      return 'auto-rescale'
    }

    if ((scaleMode === 'cropjs' || scaleMode === 'overlay') && !this.canModify) {
      // this file can't be modified
      return 'auto-rescale'
    }

    return scaleMode
  }

  /**
   * Final file to process.
   *
   * @type {File}
   */
  get fileFinal() {
    if (this.scaleMode === 'cropjs') {
      return this.fileCrop
    }

    if (this.canModify && this.fileEditor.exists) {
      return this.fileEditor
    }

    return this.file
  }

  /**
   * File for the croppper.
   *
   * @type {File}
   */
  get fileInput() {
    if (this.fileEditor.exists) {
      return this.fileEditor
    }

    return this.file
  }

  /**
   *
   * @param {File} file
   * @param {*} [model]
   */
  // eslint-disable-next-line no-unused-vars
  constructor(file, { isMaskfin = false, model = null } = {}) {
    this.id = file.md5

    this.file = file

    this.fileEditor = new File(getCropPath(`${this.id}-editor${file.extension}`), true)

    this.fileCrop = new File(getCropPath(`${this.id}-crop${file.extension}`), true)

    this.consola = Consola.create(file.fullname)

    this._setupPreferences(isMaskfin)

    this._validate()

    this._setupQueue()
  }

  async syncEditor() {
    if (isNil(this.editor)) {
      return
    }

    const dataURL = this.editor.toDataURL({
      format: this.file.extension.substring(1),
      quality: 1,
      multiplier: 1,
    })

    await this.fileEditor.writeDataURL(dataURL)
    this.consola.debug(`Saved editor changes.`)
  }

  async syncCrop() {
    if (isNil(this.cropper)) {
      return
    }

    const canvas = this.cropper.getCroppedCanvas({
      width: 512,
      height: 512,
      minWidth: 512,
      minHeight: 512,
      maxWidth: 512,
      maxHeight: 512,
      fillColor: 'white',
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high',
    })

    const dataURL = canvas.toDataURL(this.fileCrop.mimetype, 1)
    await this.fileCrop.writeDataURL(dataURL)

    this.consola.debug(`Saved crop changes.`)
  }

  getFolderPath(...args) {
    return getModelsPath(this.folderName, ...args)
  }

  _setupPreferences(isMaskfin) {
    this.preferences = cloneDeep(settings.payload.preferences)
    let forcedPreferences = {}

    if (isMaskfin) {
      forcedPreferences = {
        body: {
          executions: 1,
          randomize: false,
          progressive: {
            enabled: false,
          },
        },
        advanced: {
          scaleMode: 'auto-rescale',
          transformMode: 'import-maskfin',
          useColorTransfer: false,
        },
      }
    } else if (!this.canModify) {
      forcedPreferences = {
        advanced: {
          transformMode: 'normal',
        },
      }
    }

    this.preferences = merge(this.preferences, forcedPreferences)
  }

  _validate() {
    const { exists, mimetype, path } = this.file

    if (!exists) {
      throw new Warning('Upload failed.', `The file "${path}" does not exists.`)
    }

    if (mimetype !== 'image/jpeg' && mimetype !== 'image/png' && mimetype !== 'image/gif') {
      throw new Warning('Upload failed.', `The file "${path}" is not a valid photo. Only jpeg, png or gif.`)
    }
  }

  _setupQueue() {
    let maxTimeout = settings.processing.device === 'GPU' ? (3 * 60 * 1000) : (20 * 60 * 1000)

    if (this.file.mimetype === 'image/gif') {
      maxTimeout += (30 * 60 * 1000)
    }

    this.queue = new Queue(this._run, {
      maxTimeout,
      afterProcessDelay: 500,
      batchSize: 1,
      concurrent: 1,
      store: new MemoryStore,
    })

    this.queue.on('drain', () => {
      this.consola.debug('All runs finished.')
      this._onFinish()
    })

    this.queue.on('task_started', (runId, run) => {
      this.consola.debug(`Run #${runId} started!`)
      run.onStart()
    })

    this.queue.on('task_finish', (runId) => {
      const run = this.getRunById(runId)

      this.consola.debug(`Run #${runId} finished!`)
      run.onFinish()
    })

    this.queue.on('task_failed', (runId, error) => {
      const run = this.getRunById(runId)

      run.onFail()

      if (isError(error)) {
        handleError(error)
      } else {
        this.consola.warn(`Task failed with unknown error: ${error}`)
      }
    })
  }

  getRunById(id) {
    return this.runs[id - 1]
  }

  addToQueue() {
    Nudify.addToQueue(this)
  }

  removeFromQueue() {
    Nudify.removeFromQueue(this)
  }

  reset() {
    this.status = 'pending'

    this.timer = new Timer

    this.runs = []
  }

  async start() {
    const { executions } = this.preferences.body

    if (executions === 0) {
      return
    }

    await this.syncEditor()
    await this.syncCrop()

    this.reset()

    this.consola.debug(`Starting ${executions} runs.`)

    this._onStart()

    for (let it = 1; it <= executions; it += 1) {
      const run = new PhotoRun(it, this)

      this.runs.push(run)
      this.queue.push(run)
    }

    await new Promise((resolve) => {
      this.events.on('finish', () => {
        resolve()
      })
    })
  }

  cancel(status = 'finished') {
    this.runs.forEach((run) => {
      this.cancelRun(run)
    })

    this._onFinish(status)
  }

  cancelRun(run) {
    this.queue.cancel(run.id)
  }

  rerun(run) {
    run.reset()
    this.queue.push(run)

    this._onStart()
  }

  _run(run, cb) {
    try {
      run.start().then(() => {
        cb()
        return true
      }).catch((error) => {
        cb(error)
      })
    } catch (error) {
      cb(error)
    }

    return {
      cancel() {
        run.cancel()
      },
    }
  }

  _onStart() {
    this.status = 'running'
    this.timer.start()

    this.events.emit('start')
  }

  _onFinish(status = 'finished') {
    this.status = status
    this.timer.stop()

    this.events.emit('finish')

    this._sendNotification()
  }

  _sendNotification() {
    if (!settings.notifications.allRuns) {
      return
    }

    try {
      const browserWindow = getCurrentWindow()

      if (isNil(browserWindow) || !browserWindow.isMinimized()) {
        return
      }

      const notification = new Notification(`💖 Dream fulfilled!`, {
        icon: this.file.path,
        body: 'All runs have finished.',
      })

      notification.onclick = () => {
        browserWindow.focus()
        window.$redirect(`/nudify/${this.id}/results`)
      }
    } catch (error) {
      this.photo.consola.warn('Unable to send a notification.', error).report()
    }
  }
}
