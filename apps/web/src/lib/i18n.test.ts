import { describe, expect, it } from 'vitest'
import { translate } from './i18n'

describe('translate', () => {
  it('keeps authored Chinese labels unchanged in the Chinese locale', () => {
    expect(translate('选择工作区', 'zh-CN')).toBe('选择工作区')
    expect(translate('我的个人附件', 'zh-CN')).toBe('我的个人附件')
  })
})
