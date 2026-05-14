import { describe, test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  clearActiveEditorRegistryForTests,
  getActiveEditor,
  registerEditor,
  setActiveEditor,
  unregisterEditor,
} from './activeEditorRegistry'

describe('activeEditorRegistry', () => {
  afterEach(() => {
    clearActiveEditorRegistryForTests()
  })

  test('setActiveEditor(null) clears', () => {
    registerEditor({
      tileId: 'a',
      save: async () => {},
      saveAs: async () => {},
      revert: async () => {},
      runMonacoAction: () => {},
      toggleWordWrap: () => {},
      isDirty: () => false,
      getBuffer: () => '',
      getFilePath: () => null,
    })
    setActiveEditor(null)
    assert.equal(getActiveEditor(), null)
  })

  test('last setActiveEditor wins', () => {
    const a = {
      tileId: 'a',
      save: async () => {},
      saveAs: async () => {},
      revert: async () => {},
      runMonacoAction: () => {},
      toggleWordWrap: () => {},
      isDirty: () => false,
      getBuffer: () => '',
      getFilePath: () => null,
    }
    const b = { ...a, tileId: 'b' }
    setActiveEditor(a)
    setActiveEditor(b)
    assert.equal(getActiveEditor()?.tileId, 'b')
  })

  test('unregisterEditor clears active when same tile', () => {
    const a = {
      tileId: 'x',
      save: async () => {},
      saveAs: async () => {},
      revert: async () => {},
      runMonacoAction: () => {},
      toggleWordWrap: () => {},
      isDirty: () => false,
      getBuffer: () => '',
      getFilePath: () => null,
    }
    setActiveEditor(a)
    unregisterEditor('x')
    assert.equal(getActiveEditor(), null)
  })
})
