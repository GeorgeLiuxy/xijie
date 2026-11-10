import type { Audience, GiftCategory, GiftDefinition } from './types'

export const categoryLabels: Record<GiftCategory, [string, string]> = {
  emotion: ['心意', 'Wishes'],
  care: ['生活', 'Everyday'],
  pet: ['宠物', 'Companions'],
  home: ['住所', 'Home'],
  collection: ['旧物', 'Keepsakes'],
  scenery: ['风景', 'Scenery'],
  experience: ['体验', 'Experiences'],
  journey: ['航行', 'Journeys'],
}

// Prices are trial-postage units. This catalogue contains no payment integration.
export const giftCatalog: GiftDefinition[] = [
  // 心意
  {
    id: "paper-crane", version: 1, name: "纸鹤留言", en: "Wish crane",
    category: "emotion", icon: "bird", cost: 0, effect: "keepsake",
    outcome: "一句话随纸鹤收入信箱",
    outcomeEn: "A folded paper crane keeps your enclosed words.",
    audience: ["person", "pet", "object"], stackable: true, available: true, render: "keepsake",
  },
  {
    id: "postcard", version: 1, name: "手写明信片", en: "Handwritten card",
    category: "emotion", icon: "mail", cost: 0, effect: "keepsake",
    outcome: "保存你写下的一张卡片",
    outcomeEn: "Your enclosed note is saved as a postcard.",
    audience: ["person", "pet", "object"], stackable: true, available: true, render: "keepsake",
  },
  {
    id: "audio-capsule", version: 1, name: "录音胶囊", en: "Audio capsule",
    category: "emotion", icon: "audio-lines", cost: 5, effect: "keepsake",
    outcome: "录音上传功能筹备中，暂不扣除邮资。",
    outcomeEn: "Audio upload is being prepared. Postage is not deducted.",
    audience: ["person", "pet", "object"], stackable: true, available: false, render: "keepsake",
  },
  {
    id: "photo-projection", version: 1, name: "合照投影", en: "Photo projection",
    category: "emotion", icon: "images", cost: 8, effect: "prop",
    outcome: "照片投影功能筹备中，暂不扣除邮资。",
    outcomeEn: "Photo projection is being prepared. Postage is not deducted.",
    audience: ["person", "pet", "object"], stackable: false, available: false, render: "frame",
  },
  {
    id: "postmark", version: 1, name: "纪念邮戳", en: "Memory postmark",
    category: "emotion", icon: "stamp", cost: 3, effect: "keepsake",
    outcome: "在本次回执加盖纪念日期",
    outcomeEn: "The date is stamped on this delivery record.",
    audience: ["person", "pet", "object"], stackable: true, available: true, render: "keepsake",
  },
  {
    id: "star-lamp", version: 1, name: "星灯祝愿", en: "Wish lantern",
    category: "emotion", icon: "sparkles", cost: 2, effect: "prop",
    outcome: "一盏星灯留下一个署名祝愿",
    outcomeEn: "A named lantern keeps your enclosed wish.",
    audience: ["person", "pet", "object"], stackable: true, available: true, render: "lamp",
  },
  // 生活
  {
    id: "tea", version: 1, name: "一杯热茶", en: "A cup of tea",
    category: "care", icon: "coffee", cost: 2, effect: "scene",
    outcome: "茶桌场景模板筹备中，暂不扣除邮资。",
    outcomeEn: "The tea-table scene is being prepared. Postage is not deducted.",
    audience: ["person"], stackable: true, available: false, render: "scene",
  },
  {
    id: "meal", version: 1, name: "家常饭", en: "A home-cooked meal",
    category: "care", icon: "utensils", cost: 5, effect: "scene",
    outcome: "家常饭场景筹备中，暂不扣除邮资。",
    outcomeEn: "The meal scene is being prepared. Postage is not deducted.",
    audience: ["person"], stackable: false, available: false, render: "scene",
  },
  {
    id: "flowers", version: 1, name: "一束鲜花", en: "Flowers",
    category: "care", icon: "flower-2", cost: 3, effect: "prop",
    outcome: "摆在门前；多束合成一簇花景",
    outcomeEn: "A bouquet is placed by the door; several form a flower bed.",
    audience: ["person", "pet", "object"], stackable: true, available: true, render: "flower",
  },
  {
    id: "cloth", version: 1, name: "条纹方巾", en: "Striped scarf",
    category: "care", icon: "layers", cost: 6, effect: "prop",
    outcome: "条纹方巾留在长椅或休息角。",
    outcomeEn: "A striped scarf stays beside the bench or resting corner.",
    audience: ["person", "pet"], stackable: false, available: true, render: "cloth",
  },
  {
    id: "cushion", version: 1, name: "窗边靠垫", en: "Window cushion",
    category: "care", icon: "square", cost: 4, effect: "prop",
    outcome: "为住所添一个靠垫",
    outcomeEn: "A cushion is added to the resting corner.",
    audience: ["person", "pet"], stackable: false, available: true, render: "cloth",
  },
  {
    id: "umbrella", version: 1, name: "雨天小伞", en: "Rain umbrella",
    category: "care", icon: "umbrella", cost: 5, effect: "prop",
    outcome: "在门边留下你选的伞",
    outcomeEn: "An umbrella stays by the doorway.",
    audience: ["person"], stackable: false, available: true, render: "furniture",
  },
  // 宠物
  {
    id: "ball", version: 1, name: "旧红球", en: "Old red ball",
    category: "pet", icon: "circle", cost: 3, effect: "prop",
    outcome: "红球留在宠物空间里",
    outcomeEn: "The red ball stays in the pet space.",
    audience: ["pet"], stackable: true, available: true, render: "ball",
  },
  {
    id: "feather", version: 1, name: "逗猫羽", en: "Feather toy",
    category: "pet", icon: "feather", cost: 3, effect: "prop",
    outcome: "一支羽毛玩具收入玩具角",
    outcomeEn: "A feather toy is added to the toy corner.",
    audience: ["pet"], stackable: true, available: true, render: "plant",
  },
  {
    id: "scratch-tree", version: 1, name: "磨爪树", en: "Scratching tree",
    category: "pet", icon: "trees", cost: 12, effect: "prop",
    outcome: "为猫咪搭一处磨爪角",
    outcomeEn: "A small scratching corner is added to the pet space.",
    audience: ["pet"], stackable: false, available: true, render: "furniture",
  },
  {
    id: "sniff-meadow", version: 1, name: "嗅闻草甸", en: "Sniffing meadow",
    category: "pet", icon: "flower", cost: 14, effect: "scene",
    outcome: "草甸场景筹备中，暂不扣除邮资。",
    outcomeEn: "The meadow scene is being prepared. Postage is not deducted.",
    audience: ["pet"], stackable: false, available: false, render: "scene",
  },
  {
    id: "sun-mat", version: 1, name: "晒太阳垫", en: "Sunshine mat",
    category: "pet", icon: "sun", cost: 6, effect: "prop",
    outcome: "在窗边铺一张软垫",
    outcomeEn: "A soft mat is placed beside the window.",
    audience: ["pet"], stackable: false, available: true, render: "cloth",
  },
  {
    id: "walk-pass", version: 1, name: "沿桥散步", en: "Bridge walk",
    category: "pet", icon: "footprints", cost: 10, effect: "service",
    outcome: "散步场景创作筹备中，暂不扣除邮资。",
    outcomeEn: "Activity-scene creation is being prepared. Postage is not deducted.",
    audience: ["pet"], stackable: false, available: false, render: "scene",
  },
  // 住所
  {
    id: "nameplate", version: 1, name: "住所门牌", en: "Home nameplate",
    category: "home", icon: "tag", cost: 5, effect: "prop",
    outcome: "把你写的名字挂在门边",
    outcomeEn: "The enclosed words are saved on a home nameplate.",
    audience: ["person", "pet", "object"], stackable: false, available: true, render: "frame",
  },
  {
    id: "bench", version: 1, name: "候车长椅", en: "Waiting bench",
    category: "home", icon: "armchair", cost: 16, effect: "prop",
    outcome: "在住所添一张长椅",
    outcomeEn: "A bench is added to the receiving place.",
    audience: ["person", "pet", "object"], stackable: false, available: true, render: "furniture",
  },
  {
    id: "bookshelf", version: 1, name: "回忆书架", en: "Memory bookshelf",
    category: "home", icon: "book-open", cost: 15, effect: "prop",
    outcome: "给已保存的故事一个展架",
    outcomeEn: "A bookshelf displays the stories kept here.",
    audience: ["person", "pet", "object"], stackable: false, available: true, render: "furniture",
  },
  {
    id: "sunset-window", version: 1, name: "日落窗景", en: "Sunset window",
    category: "home", icon: "panel-top", cost: 20, effect: "scene",
    outcome: "定制窗景筹备中，暂不扣除邮资。",
    outcomeEn: "Custom window scenery is being prepared. Postage is not deducted.",
    audience: ["person", "pet", "object"], stackable: false, available: false, render: "scene",
  },
  {
    id: "hearth", version: 1, name: "小壁炉", en: "Small hearth",
    category: "home", icon: "flame", cost: 18, effect: "prop",
    outcome: "点亮住所的暖光角落",
    outcomeEn: "A hearth adds a warm-lit corner.",
    audience: ["person", "pet"], stackable: false, available: true, render: "lamp",
  },
  {
    id: "roof", version: 1, name: "避雨屋顶", en: "Shelter roof",
    category: "home", icon: "house", cost: 24, effect: "build",
    outcome: "为一处共建空间补屋顶",
    outcomeEn: "A roof blueprint can be contributed to a shared shelter.",
    audience: ["person", "pet", "object"], stackable: false, available: true, render: "furniture",
  },
  // 旧物
  {
    id: "film-roll", version: 1, name: "记忆胶卷", en: "Memory film",
    category: "collection", icon: "film", cost: 5, effect: "keepsake",
    outcome: "把随件回忆保存成一张胶卷故事卡。",
    outcomeEn: "Your enclosed memory is saved as a film-frame card.",
    audience: ["object", "person"], stackable: true, available: true, render: "frame",
  },
  {
    id: "camera-strap", version: 1, name: "相机背带", en: "Camera strap",
    category: "collection", icon: "camera", cost: 6, effect: "prop",
    outcome: "给旧相机的陈列添一条背带",
    outcomeEn: "A strap is added to the old-camera display.",
    audience: ["object"], stackable: false, available: true, render: "cloth",
  },
  {
    id: "needle", version: 1, name: "旧唱针", en: "Record needle",
    category: "collection", icon: "disc-3", cost: 6, effect: "prop",
    outcome: "一段音乐记忆的陈列物",
    outcomeEn: "A small object keeps the memory of a song.",
    audience: ["object"], stackable: false, available: true, render: "keepsake",
  },
  {
    id: "record-rack", version: 1, name: "唱片收纳架", en: "Record rack",
    category: "collection", icon: "library", cost: 12, effect: "prop",
    outcome: "为旧唱片安排一处陈列",
    outcomeEn: "A rack gives old records a display place.",
    audience: ["object", "person"], stackable: false, available: true, render: "furniture",
  },
  {
    id: "bike-bell", version: 1, name: "自行车铃", en: "Bicycle bell",
    category: "collection", icon: "bike", cost: 5, effect: "prop",
    outcome: "留下一段骑行往事的线索",
    outcomeEn: "A bell keeps a memory of a ride.",
    audience: ["object"], stackable: false, available: true, render: "keepsake",
  },
  {
    id: "display-case", version: 1, name: "旧物陈列罩", en: "Display cover",
    category: "collection", icon: "archive", cost: 15, effect: "prop",
    outcome: "为珍藏的旧物添保护罩",
    outcomeEn: "A display cover is added for a cherished object.",
    audience: ["object"], stackable: false, available: true, render: "frame",
  },
  // 风景
  {
    id: "glow-seed", version: 1, name: "萤光花种", en: "Glowflower seeds",
    category: "scenery", icon: "sprout", cost: 4, effect: "scene",
    outcome: "花种生长场景筹备中，暂不扣除邮资。",
    outcomeEn: "The planted-flower scene is being prepared. Postage is not deducted.",
    audience: ["person", "pet", "object"], stackable: true, available: false, render: "plant",
  },
  {
    id: "rainbow", version: 1, name: "雨后彩虹", en: "After-rain rainbow",
    category: "scenery", icon: "rainbow", cost: 10, effect: "scene",
    outcome: "彩虹场景筹备中，暂不扣除邮资。",
    outcomeEn: "The rainbow scene is being prepared. Postage is not deducted.",
    audience: ["person", "pet", "object"], stackable: false, available: false, render: "scene",
  },
  {
    id: "sky-map", version: 1, name: "夜空星图", en: "Night-sky map",
    category: "scenery", icon: "orbit", cost: 12, effect: "scene",
    outcome: "窗外星空场景筹备中，暂不扣除邮资。",
    outcomeEn: "The window-sky scene is being prepared. Postage is not deducted.",
    audience: ["person", "pet", "object"], stackable: false, available: false, render: "scene",
  },
  {
    id: "path-lamp", version: 1, name: "门前路灯", en: "Path lamp",
    category: "scenery", icon: "lamp", cost: 8, effect: "prop",
    outcome: "点亮住所的一段路",
    outcomeEn: "A lamp lights part of the path to this place.",
    audience: ["person", "pet", "object"], stackable: true, available: true, render: "lamp",
  },
  {
    id: "pond", version: 1, name: "小水池", en: "Small pond",
    category: "scenery", icon: "waves", cost: 16, effect: "scene",
    outcome: "水景场景筹备中，暂不扣除邮资。",
    outcomeEn: "The pond scene is being prepared. Postage is not deducted.",
    audience: ["person", "pet", "object"], stackable: false, available: false, render: "scene",
  },
  {
    id: "station-clock", version: 1, name: "站台钟", en: "Station clock",
    category: "scenery", icon: "clock-3", cost: 12, effect: "prop",
    outcome: "为站台留一只纪念时钟",
    outcomeEn: "A commemorative clock stays at the station.",
    audience: ["person", "pet", "object"], stackable: false, available: true, render: "furniture",
  },
  // 体验
  {
    id: "meteor-night", version: 1, name: "流星雨之夜", en: "Meteor night",
    category: "experience", icon: "sparkles", cost: 30, effect: "service",
    outcome: "流星夜场景创作筹备中，暂不扣除邮资。",
    outcomeEn: "Meteor-night creation is being prepared. Postage is not deducted.",
    audience: ["person", "pet", "object"], stackable: false, available: false, render: "scene",
  },
  {
    id: "sunset-tea", version: 1, name: "夕阳茶会", en: "Sunset tea party",
    category: "experience", icon: "sunset", cost: 18, effect: "service",
    outcome: "茶会场景创作筹备中，暂不扣除邮资。",
    outcomeEn: "Tea-party creation is being prepared. Postage is not deducted.",
    audience: ["person"], stackable: false, available: false, render: "scene",
  },
  {
    id: "music-box", version: 1, name: "录音八音盒", en: "Voice music box",
    category: "experience", icon: "music", cost: 20, effect: "keepsake",
    outcome: "录音与声音创作筹备中，暂不扣除邮资。",
    outcomeEn: "Audio creation is being prepared. Postage is not deducted.",
    audience: ["person", "pet", "object"], stackable: false, available: false, render: "keepsake",
  },
  {
    id: "camp", version: 1, name: "一次露营", en: "A camping trip",
    category: "experience", icon: "tent", cost: 24, effect: "service",
    outcome: "露营场景创作筹备中，暂不扣除邮资。",
    outcomeEn: "Camping-scene creation is being prepared. Postage is not deducted.",
    audience: ["person", "pet"], stackable: false, available: false, render: "scene",
  },
  {
    id: "photo-restore", version: 1, name: "老照片修复", en: "Photo restoration",
    category: "experience", icon: "wand-sparkles", cost: 16, effect: "service",
    outcome: "图像修复服务筹备中，暂不扣除邮资。",
    outcomeEn: "Image-restoration service is being prepared. Postage is not deducted.",
    audience: ["object", "person"], stackable: true, available: false, render: "frame",
  },
  {
    id: "family-letter", version: 1, name: "合写家书", en: "Family letter",
    category: "experience", icon: "notebook-pen", cost: 0, effect: "keepsake",
    outcome: "把随件的话保存成一张家书卡片。",
    outcomeEn: "Your enclosed words are kept as a family-letter card.",
    audience: ["person", "pet", "object"], stackable: false, available: true, render: "keepsake",
  },
  // 航行
  {
    id: "fuel", version: 1, name: "补给芯", en: "Fuel cell",
    category: "journey", icon: "battery-charging", cost: 2, effect: "fuel",
    outcome: "用于特别航班补给目标",
    outcomeEn: "Fuel cells contribute to a special-flight goal.",
    audience: ["person", "pet", "object"], stackable: true, available: true, render: "package",
  },
  {
    id: "folded-bag", version: 1, name: "折叠邮袋", en: "Folded mailbag",
    category: "journey", icon: "package", cost: 8, effect: "keepsake",
    outcome: "一张折叠邮袋式回执，保存随件留言。",
    outcomeEn: "A mailbag-style keepsake holds your enclosed note.",
    audience: ["person", "pet", "object"], stackable: false, available: true, render: "keepsake",
  },
  {
    id: "return-stamp", version: 1, name: "回程邮票", en: "Return postage",
    category: "journey", icon: "ticket", cost: 8, effect: "service",
    outcome: "通过共同目标获得，可兑换一次基础虚拟寄件。",
    outcomeEn: "Earn it through a shared goal and use it for one basic parcel.",
    audience: ["person", "pet", "object"], stackable: true, available: false, render: "keepsake",
  },
  {
    id: "beacon", version: 1, name: "同行航标", en: "Companion beacon",
    category: "journey", icon: "radio-tower", cost: 5, effect: "prop",
    outcome: "一枚写有随件祝愿的同行航标。",
    outcomeEn: "A beacon keeps your name and enclosed wish.",
    audience: ["person", "pet", "object"], stackable: true, available: true, render: "lamp",
  },
  {
    id: "seat", version: 1, name: "共乘舱位", en: "Shared cargo berth",
    category: "journey", icon: "ship", cost: 8, effect: "service",
    outcome: "特别合寄舱位服务筹备中，暂不扣除邮资。",
    outcomeEn: "Shared-berth service is being prepared. Postage is not deducted.",
    audience: ["person", "pet", "object"], stackable: true, available: false, render: "package",
  },
  {
    id: "station-kit", version: 1, name: "驿站建造包", en: "Outpost building kit",
    category: "journey", icon: "construction", cost: 22, effect: "build",
    outcome: "一组可投入住所共建的部件",
    outcomeEn: "A kit of parts can be contributed to a shared place.",
    audience: ["person", "pet", "object"], stackable: false, available: true, render: "package",
  },
]

const byId = new Map(giftCatalog.map(gift => [gift.id, gift]))

export function getGift(id: string): GiftDefinition | undefined {
  return byId.get(id)
}

export function inferAudience(person: { relation: string; name: string }): Audience {
  const relation = person.relation.toLowerCase()
  if (/宠物|爱宠|猫|狗|兔|鸟|仓鼠|动物|pet|companion animal|cat|dog|rabbit|bird/.test(relation)) return 'pet'
  if (/旧物|物件|物品|相机|自行车|唱片|玩偶|object|keepsake|camera|bicycle/.test(relation)) return 'object'
  const name = person.name.toLowerCase()
  if (/旧相机|老相机|旧自行车|老自行车|旧唱片|camera|bicycle/.test(name)) return 'object'
  return 'person'
}
