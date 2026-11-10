import type { Icon, IconProps } from '@phosphor-icons/react'
import {
  ArchiveIcon, ArmchairIcon, BatteryChargingIcon, BicycleIcon, BirdIcon,
  BookOpenIcon, BooksIcon, BroadcastIcon, CameraIcon, CampfireIcon, CircleIcon,
  ClockIcon, CoffeeIcon, EnvelopeSimpleIcon, FeatherIcon, FilmStripIcon,
  FlowerIcon, ForkKnifeIcon, FrameCornersIcon, GiftIcon as PresentIcon,
  HammerIcon, HouseSimpleIcon, ImagesIcon, LampIcon, MagicWandIcon,
  MusicNotesIcon, NotePencilIcon, PackageIcon, PawPrintIcon, PlanetIcon,
  PlantIcon, RainbowIcon, RocketLaunchIcon, SparkleIcon, SquareIcon,
  StackIcon, StampIcon, SunHorizonIcon, SunIcon, TagIcon, TentIcon,
  TicketIcon, TreeIcon, UmbrellaIcon, WavesIcon, WaveformIcon,
} from '@phosphor-icons/react'
import { getGift } from './catalog'
import ball from '../post/assets/ball.webp'
import cloth from '../post/assets/cloth.webp'

const glyphs: Record<string, Icon> = {
  bird: BirdIcon, mail: EnvelopeSimpleIcon, 'audio-lines': WaveformIcon,
  images: ImagesIcon, stamp: StampIcon, sparkles: SparkleIcon,
  coffee: CoffeeIcon, utensils: ForkKnifeIcon, 'flower-2': FlowerIcon,
  layers: StackIcon, square: SquareIcon, umbrella: UmbrellaIcon,
  circle: CircleIcon, feather: FeatherIcon, trees: TreeIcon,
  flower: FlowerIcon, sun: SunIcon, footprints: PawPrintIcon,
  tag: TagIcon, armchair: ArmchairIcon, 'book-open': BookOpenIcon,
  'panel-top': FrameCornersIcon, flame: CampfireIcon, house: HouseSimpleIcon,
  film: FilmStripIcon, camera: CameraIcon, 'disc-3': MusicNotesIcon,
  library: BooksIcon, bike: BicycleIcon, archive: ArchiveIcon,
  sprout: PlantIcon, rainbow: RainbowIcon, orbit: PlanetIcon,
  lamp: LampIcon, waves: WavesIcon, 'clock-3': ClockIcon,
  sunset: SunHorizonIcon, music: MusicNotesIcon, tent: TentIcon,
  'notebook-pen': NotePencilIcon, 'wand-sparkles': MagicWandIcon,
  'battery-charging': BatteryChargingIcon, package: PackageIcon,
  ticket: TicketIcon, 'radio-tower': BroadcastIcon, ship: RocketLaunchIcon,
  construction: HammerIcon,
}

export function GiftIcon({ id, className = '', ...props }: { id: string; className?: string } & Omit<IconProps, 'id' | 'className'>) {
  if (id === 'ball' || id === 'cloth') {
    return <img className={'gift-icon gift-icon-photo ' + className} src={id === 'ball' ? ball : cloth} alt="" draggable={false} />
  }
  const definition = getGift(id)
  const Glyph = definition ? glyphs[definition.icon] ?? PresentIcon : PackageIcon
  return <Glyph className={'gift-icon ' + className} weight="duotone" aria-hidden="true" {...props} />
}
