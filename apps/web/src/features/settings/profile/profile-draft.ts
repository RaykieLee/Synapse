export type ProfileValues = {
  nick_name: string
  email: string
  phonenumber: string
  sex: string
  avatar: string
}

type ProfileDraft = {
  accountId: string
  values: ProfileValues
}

let activeAccountId: string | null = null
let profileDraft: ProfileDraft | null = null

function switchAccount(accountId: string) {
  if (activeAccountId !== null && activeAccountId !== accountId) {
    profileDraft = null
  }
  activeAccountId = accountId
}

const copyDraft = (draft: ProfileDraft): ProfileDraft => ({
  accountId: draft.accountId,
  values: { ...draft.values },
})

export function getProfileDraft(accountId: string): ProfileDraft | null {
  switchAccount(accountId)
  return profileDraft?.accountId === accountId ? copyDraft(profileDraft) : null
}

export function getSuspendedProfileDraft(): ProfileDraft | null {
  return profileDraft ? copyDraft(profileDraft) : null
}

export function saveProfileDraft(accountId: string, values: ProfileValues) {
  switchAccount(accountId)
  profileDraft = { accountId, values: { ...values } }
}

export function clearProfileDraft(accountId?: string) {
  if (accountId === undefined) {
    activeAccountId = null
    profileDraft = null
  } else if (profileDraft?.accountId === accountId) {
    profileDraft = null
  }
}
