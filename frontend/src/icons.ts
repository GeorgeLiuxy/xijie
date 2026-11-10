import { createElement, forwardRef } from 'react'
import type { Icon, IconProps } from '@phosphor-icons/react'
import { PlusIcon } from '@phosphor-icons/react/Plus'
import { XIcon } from '@phosphor-icons/react/X'
import { CaretLeftIcon } from '@phosphor-icons/react/CaretLeft'
import { CaretRightIcon } from '@phosphor-icons/react/CaretRight'
import { CheckIcon } from '@phosphor-icons/react/Check'
import { ListBulletsIcon } from '@phosphor-icons/react/ListBullets'

// Navigation marks stay legible inside a button; filled pictograms inherit the app default.
function control(Glyph: Icon) {
  return forwardRef<SVGSVGElement, IconProps>((props, ref) => createElement(Glyph, { weight: 'bold', ...props, ref }))
}
export const Plus = control(PlusIcon)
export const X = control(XIcon)
export const Back = control(CaretLeftIcon)
export const Chevron = control(CaretRightIcon)
export const Check = control(CheckIcon)
export const List = control(ListBulletsIcon)

export { ChatsCircleIcon as Meet } from '@phosphor-icons/react/ChatsCircle'
export { PlanetIcon as Atlas } from '@phosphor-icons/react/Planet'
export { UserCircleIcon as Me } from '@phosphor-icons/react/UserCircle'
export { MagnifyingGlassIcon as Search } from '@phosphor-icons/react/MagnifyingGlass'
export { SignatureIcon as Name } from '@phosphor-icons/react/Signature'
export { IdentificationCardIcon as Face } from '@phosphor-icons/react/IdentificationCard'
export { WaveformIcon as Voice } from '@phosphor-icons/react/Waveform'
export { BookOpenTextIcon as Story } from '@phosphor-icons/react/BookOpenText'
export { ClockIcon as Time } from '@phosphor-icons/react/Clock'
export { MapPinIcon as Place } from '@phosphor-icons/react/MapPin'
export { MicrophoneIcon as Mic } from '@phosphor-icons/react/Microphone'
export { MicrophoneSlashIcon as MicOff } from '@phosphor-icons/react/MicrophoneSlash'
export { KeyboardIcon as Keyboard } from '@phosphor-icons/react/Keyboard'
export { PhoneIcon as Phone } from '@phosphor-icons/react/Phone'
export { VideoCameraIcon as Video } from '@phosphor-icons/react/VideoCamera'
export { ImageSquareIcon as Photo } from '@phosphor-icons/react/ImageSquare'
export { CameraIcon as Camera } from '@phosphor-icons/react/Camera'
export { EnvelopeSimpleIcon as Mail } from '@phosphor-icons/react/EnvelopeSimple'
export { BookmarkSimpleIcon as Keep } from '@phosphor-icons/react/BookmarkSimple'
export { UsersThreeIcon as Gather } from '@phosphor-icons/react/UsersThree'
export { GearSixIcon as Gear } from '@phosphor-icons/react/GearSix'
export { PaperPlaneTiltIcon as Send } from '@phosphor-icons/react/PaperPlaneTilt'
export { CopyIcon as Copy } from '@phosphor-icons/react/Copy'
export { TrashIcon as Trash } from '@phosphor-icons/react/Trash'
export { SpeakerHighIcon as Speaker } from '@phosphor-icons/react/SpeakerHigh'
export { ClosedCaptioningIcon as Captions } from '@phosphor-icons/react/ClosedCaptioning'
export { StopIcon as Stop } from '@phosphor-icons/react/Stop'
export { GlobeHemisphereEastIcon as Globe } from '@phosphor-icons/react/GlobeHemisphereEast'
export { PlayIcon as Play } from '@phosphor-icons/react/Play'
export { AppleLogoIcon as Apple } from '@phosphor-icons/react/AppleLogo'
export { WechatLogoIcon as Wechat } from '@phosphor-icons/react/WechatLogo'
export { FlaskIcon as Bottle } from '@phosphor-icons/react/Flask'
export { PaperPlaneRightIcon as PaperBird } from '@phosphor-icons/react/PaperPlaneRight'
export { MailboxIcon as Mailbox } from '@phosphor-icons/react/Mailbox'
export { CellSignalFullIcon as Signal } from '@phosphor-icons/react/CellSignalFull'
export { BatteryHighIcon as Battery } from '@phosphor-icons/react/BatteryHigh'
