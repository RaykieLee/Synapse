import { authTranslationModule } from './auth'
import { attachmentsTranslationModule } from './attachments'
import { commonTranslationModule } from './common'
import { dashboardTranslationModule } from './dashboard'
import { legacyTranslationModule } from './legacy'
import { navigationTranslationModule } from './navigation'
import { settingsTranslationModule } from './settings'
import { tenantsTranslationModule } from './tenants'
import { workspacesTranslationModule } from './workspaces'
import { composeTranslationLookupChains } from './catalog'

export {
  findDuplicateModuleIds,
  findDuplicateTranslationEntryKeys,
  findMissingLocaleKeys,
  validateTranslationCatalog,
} from './catalog'

export const translationCatalogModules = [
  authTranslationModule,
  attachmentsTranslationModule,
  commonTranslationModule,
  dashboardTranslationModule,
  legacyTranslationModule,
  navigationTranslationModule,
  settingsTranslationModule,
  tenantsTranslationModule,
  workspacesTranslationModule,
] as const

export const translationLookupChains = composeTranslationLookupChains(
  translationCatalogModules,
)
