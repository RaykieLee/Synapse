export const supportedLocales = ['zh-CN', 'en'] as const

export type Locale = (typeof supportedLocales)[number]

export type BilingualMessage = Readonly<Record<Locale, string>>

export type CatalogLookup = Readonly<{
  targetLocale: Locale
  sourceText: string
  translatedText: string
  chainOrder: number
  mergeOrder: number
  entryOrder: number
}>

export type TranslationCatalogEntry = Readonly<{
  key: string
  locales: BilingualMessage
  lookups: readonly CatalogLookup[]
}>

export type TranslationCatalogModule = Readonly<{
  id: string
  entries: readonly TranslationCatalogEntry[]
}>

export type TranslationLookupChain = Readonly<{
  chainOrder: number
  translations: ReadonlyMap<string, string>
}>

export type TranslationLookupChains = Readonly<
  Record<Locale, readonly TranslationLookupChain[]>
>

export type TranslationLookupRange = Readonly<{
  fromChainOrder?: number
  throughChainOrder?: number
}>

type OrderedMessage = readonly [order: number, source: string, target: string]

function translationKey(sourceMap: string, mergeOrder: number, entryOrder: number) {
  return `${sourceMap}:${mergeOrder}:${entryOrder}`
}

export function fromChineseToEnglish(
  sourceMap: string,
  chainOrder: number,
  mergeOrder: number,
  messages: readonly OrderedMessage[],
): readonly TranslationCatalogEntry[] {
  return messages.map(([entryOrder, chinese, english]) => ({
    key: translationKey(sourceMap, mergeOrder, entryOrder),
    locales: { 'zh-CN': chinese, en: english },
    lookups: [
      {
        targetLocale: 'en',
        sourceText: chinese,
        translatedText: english,
        chainOrder,
        mergeOrder,
        entryOrder,
      },
    ],
  }))
}

export function fromChineseToEnglishRecord(
  sourceMap: string,
  chainOrder: number,
  mergeOrder: number,
  messages: Readonly<Record<string, string>>,
): readonly TranslationCatalogEntry[] {
  return fromChineseToEnglish(
    sourceMap,
    chainOrder,
    mergeOrder,
    Object.entries(messages).map(([chinese, english], entryOrder) => [
      entryOrder,
      chinese,
      english,
    ]),
  )
}

export function fromEnglishToChinese(
  sourceMap: string,
  chainOrder: number,
  mergeOrder: number,
  messages: readonly OrderedMessage[],
  options: Readonly<{ sourceMayContainChinese?: boolean }> = {},
): readonly TranslationCatalogEntry[] {
  return messages.map(([entryOrder, english, chinese]) => {
    const legacyChineseSource =
      options.sourceMayContainChinese && /[\u3400-\u9fff]/.test(english)

    return {
      key: translationKey(sourceMap, mergeOrder, entryOrder),
      locales: legacyChineseSource
        ? { 'zh-CN': english, en: chinese }
        : { 'zh-CN': chinese, en: english },
      lookups: legacyChineseSource
        ? []
        : [
            {
              targetLocale: 'zh-CN',
              sourceText: english,
              translatedText: chinese,
              chainOrder,
              mergeOrder,
              entryOrder,
            },
          ],
    }
  })
}

export function defineTranslationModule<const Id extends string>(
  id: Id,
  entries: readonly TranslationCatalogEntry[],
): TranslationCatalogModule & Readonly<{ id: Id }> {
  return { id, entries }
}

type TranslationCatalogShape = Readonly<{
  id: string
  entries: readonly Readonly<{
    key: string
    locales: Partial<Record<Locale, unknown>>
  }>[]
}>

export function findMissingLocaleKeys(
  modules: readonly TranslationCatalogShape[],
): readonly string[] {
  return modules.flatMap((module) =>
    module.entries.flatMap((entry) =>
      supportedLocales
        .filter((locale) => {
          const value = entry.locales?.[locale]
          return typeof value !== 'string' || value.length === 0
        })
        .map((locale) => `${module.id}.${entry.key}.${locale}`),
    ),
  )
}

export function findDuplicateModuleIds(
  modules: readonly Readonly<{ id: string }>[],
): readonly string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()

  for (const module of modules) {
    if (seen.has(module.id)) duplicates.add(module.id)
    seen.add(module.id)
  }

  return [...duplicates]
}

export function findDuplicateTranslationEntryKeys(
  modules: readonly TranslationCatalogShape[],
): readonly string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()

  for (const module of modules) {
    for (const entry of module.entries) {
      if (seen.has(entry.key)) duplicates.add(entry.key)
      seen.add(entry.key)
    }
  }

  return [...duplicates]
}

export function validateTranslationCatalog(
  modules: readonly TranslationCatalogShape[],
) {
  return {
    duplicateModuleIds: findDuplicateModuleIds(modules),
    duplicateEntryKeys: findDuplicateTranslationEntryKeys(modules),
    missingLocaleKeys: findMissingLocaleKeys(modules),
  }
}

export function composeTranslationLookupChains(
  modules: readonly TranslationCatalogModule[],
): TranslationLookupChains {
  const lookupsByLocale: Record<Locale, CatalogLookup[]> = {
    'zh-CN': [],
    en: [],
  }

  for (const module of modules) {
    for (const entry of module.entries) {
      for (const lookup of entry.lookups) {
        lookupsByLocale[lookup.targetLocale].push(lookup)
      }
    }
  }

  const createChains = (locale: Locale): readonly TranslationLookupChain[] => {
    const lookups = [...lookupsByLocale[locale]].sort(
      (left, right) =>
        left.chainOrder - right.chainOrder ||
        left.mergeOrder - right.mergeOrder ||
        left.entryOrder - right.entryOrder,
    )
    const groups = new Map<number, Map<string, string>>()

    for (const lookup of lookups) {
      let group = groups.get(lookup.chainOrder)
      if (!group) {
        group = new Map<string, string>()
        groups.set(lookup.chainOrder, group)
      }
      group.set(lookup.sourceText, lookup.translatedText)
    }

    return [...groups.entries()]
      .sort(([left], [right]) => left - right)
      .map(([chainOrder, translations]) => ({ chainOrder, translations }))
  }

  return {
    'zh-CN': createChains('zh-CN'),
    en: createChains('en'),
  }
}

export function lookupTranslation(
  chains: TranslationLookupChains,
  text: string,
  targetLocale: Locale,
  range: TranslationLookupRange = {},
): string | undefined {
  for (const chain of chains[targetLocale]) {
    if (
      range.fromChainOrder !== undefined &&
      chain.chainOrder < range.fromChainOrder
    ) {
      continue
    }
    if (
      range.throughChainOrder !== undefined &&
      chain.chainOrder > range.throughChainOrder
    ) {
      continue
    }

    const translated = chain.translations.get(text)
    if (translated !== undefined) return translated
  }

  return undefined
}
