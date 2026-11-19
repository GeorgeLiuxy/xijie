import { createContext, useContext } from 'react'
import type { GiftNotification, GiftService } from '../serviceGifts'
export const GiftServiceContext = createContext<GiftService | undefined>(undefined)
export const useGiftService = () => useContext(GiftServiceContext)
export function giftPhotoMessage(code: string | undefined, zh: boolean) {
  return code === 'GIFT_PHOTO_PERMISSION_REQUIRED' ? zh ? '请到「我」里的「隐私与 AI 说明」同意说明，再回来观看旅途。' : 'Agree to the statement in Me → Privacy & AI, then return to watch the journey.'
    : code === 'DELIVERY_NOT_ARRIVED' ? zh ? '礼物抵达后，就可以观看这次旅途。' : 'You can watch this journey once the gift has arrived.'
    : code === 'JOURNEY_UNAVAILABLE' ? zh ? '这份礼物的旅途暂时无法观看，请稍后重试。' : 'This gift journey is unavailable. Please try again later.'
    : code === 'VERSION_CONFLICT' ? zh ? '留影已有更新，已保留当前照片。可以重新观看这次旅途。' : 'The photo has changed. The current photo is kept; you can watch the journey again.'
    : code === 'NOT_FOUND' ? zh ? '这份礼物的记录暂时无法读取。' : 'This gift record is unavailable.'
    : code === 'GIFT_STORAGE_PERMISSION_REQUIRED' ? zh ? '请到「我」里的「隐私与 AI 说明」同意说明，再回来重试。' : 'Agree to the statement in Me → Privacy & AI, then return and retry.'
    : zh ? '暂时看不到这次留影是否保存成功。可再点「观看这次旅途」继续，原有留影会保留。' : 'We could not check whether this photo was saved. Select Watch the journey to continue; your previous photo is kept.'
}
export function giftNoticeText(type: GiftNotification['type'], zh: boolean) {
  return type === 'gift_received' ? zh ? '收到一份心意' : 'A gift has arrived for you' : type === 'gift_failed' ? zh ? '礼物投递未完成' : 'Gift delivery was not completed' : zh ? '礼物已抵达' : 'Your gift has arrived'
}
export const giftServiceMessage = (code: string | undefined, zh: boolean, action: 'read' | 'save' = 'read') => code === 'GIFT_RETURN_PERMISSION_REQUIRED'
  ? zh ? '请到「我」里的「隐私与 AI 说明」同意说明，再回来查看回礼。' : 'Agree to the statement in Me → Privacy & AI, then return to view the gift.'
  : code === 'VERSION_CONFLICT' ? zh ? '这份礼物的状态刚刚更新，请刷新后再操作。' : 'This gift’s status has changed. Refresh before trying again.'
  : code === 'NOT_FOUND' ? zh ? '这份礼物的记录暂时无法读取。' : 'This gift record is unavailable.'
  : code === 'GIFT_NOT_DISPLAYABLE' ? zh ? '这份心意可以保存在礼物记录里。' : 'This gift can be kept in your gift records.'
  : code === 'FORBIDDEN' ? zh ? '当前账号无法查看或修改这份礼物，请返回礼物记录。' : 'This account cannot view or change this gift. Return to your gift records.'
  : code === 'GIFT_STORAGE_PERMISSION_REQUIRED' || code === 'GIFT_PERMISSION_REQUIRED' || code === 'AUTHORIZATION_CHANGED'
  ? zh ? '请到「我」里的「隐私与 AI 说明」同意说明，再回来重试。' : 'Agree to the statement in Me → Privacy & AI, then return and retry.'
  : action === 'save' ? zh ? '暂时看不到这次操作是否保存成功，请重试。' : 'We could not check whether this change was saved. Please retry.'
  : zh ? '礼物和邮资暂时加载不出来，请重试。' : 'Gifts and postage could not be loaded. Please retry.'
