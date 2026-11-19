/** Existing server purposes and pending keys remain stable across both permission interfaces. */
export const consentPurposes = [
  { purpose: 'private_story_storage', authority: 'storyStorage', pending: 'text-storage' },
  { purpose: 'private_photo_storage', authority: 'photoStorage', pending: 'photo-storage' },
  { purpose: 'private_person_photo_storage', authority: 'personPhotoStorage', pending: 'person-photo-storage' },
  { purpose: 'private_person_voice_storage', authority: 'personVoiceStorage', pending: 'person-voice' },
  { purpose: 'virtual_gift_storage', authority: 'giftStorage', pending: 'gift-storage' },
  { purpose: 'gift_delivery_photo_storage', authority: 'giftPhotoStorage', pending: 'gift-photo' },
  { purpose: 'private_letter_storage', authority: 'letterStorage', pending: 'letter-storage' },
  { purpose: 'private_chat_photo_storage', authority: 'chatPhotoStorage', pending: 'chat-photo' },
  { purpose: 'ai_text_processing', authority: 'aiTextProcessing', pending: 'ai-text' },
  { purpose: 'person_gift_returns', authority: 'giftReturns', pending: 'gift-returns' },
  { purpose: 'person_letter_replies', authority: 'letterReplies', pending: 'letter-replies' },
  { purpose: 'person_gather_replies', authority: 'gatherReplies', pending: 'gather-replies' },
  { purpose: 'person_chat_image_replies', authority: 'chatImageReplies', pending: 'chat-image-replies' },
  { purpose: 'person_world_actions', authority: 'worldActionProcessing', pending: 'world-action' },
  { purpose: 'person_story_branches', authority: 'storyBranches', pending: 'story-branches' },
  { purpose: 'person_offline_life', authority: 'offlineLife', pending: 'offline-life' },
  { purpose: 'person_voice_calls', authority: 'voiceCalls', pending: 'voice-calls' },
  { purpose: 'production_model_execution', authority: 'productionModelExecution', pending: 'production-model' },
] as const
// Speech is available through its own permission control, outside the unified agreement.
export type ProcessingPurpose = (typeof consentPurposes)[number]['purpose'] | 'private_chat_reply_speech'
export type Purpose = 'privacy_notice' | ProcessingPurpose
export const permissionIntentKey = (sessionId: string, purpose: ProcessingPurpose) => {
  const pending = purpose === 'private_chat_reply_speech'
    ? 'chat-reply-speech' : consentPurposes.find(item => item.purpose === purpose)!.pending
  return 'xijie.' + pending + '-permission.intent.' + sessionId
}
