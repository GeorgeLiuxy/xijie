import assert from 'node:assert/strict'
import { test } from 'node:test'
import { needsCurrentSelfHarmSupport } from '../dist/conversation-safety.js'

test('direct, first-person imminent statements activate the local response path', () => {
  for (const value of [
    '我现在就要自杀。',
    '我今天很慌，但是我今晚打算结束自己的生命。',
    '我马上伤害自己。',
    '我正在自残。',
    '我准备今晚自杀。',
    '今晚我计划伤害自己。',
    'I am about to end my life.',
    'I’m going to kill myself.',
    'Tonight, I plan to harm myself.',
    'I will kill myself now.',
    'I am harming myself right now.',
    "I don't want to die, but I'm going to kill myself tonight.",
  ]) assert.equal(needsCurrentSelfHarmSupport(value), true, value)
})

test('negation, historical and reported statements, hypotheticals and ordinary distress preserve conversation', () => {
  for (const value of [
    '我很难过，最近什么事都没精力做。',
    '我今晚不会自杀。',
    '我去年想自杀，现在没事了。',
    '我昨天说我现在要自杀，后来状态稳定了。',
    '朋友说，我现在要自杀。',
    '「我现在要自杀」是电影台词。',
    '请翻译「我今晚要自杀」。',
    '假如在剧本里，我现在要自杀，人物怎么反应？',
    '我在学习自杀预防知识。',
    '我今天自杀预防讲座有空。',
    'I am having a terrible day and do not know how to cope.',
    'I do not intend to harm myself tonight.',
    "I'm not going to kill myself.",
    'I wanted to end my life last year, and I found support.',
    'Yesterday, I said I would kill myself today.',
    'My friend said, I am going to kill myself.',
    'The line in the book is "I plan to kill myself tonight".',
    'If this were a script, I am going to kill myself in the final scene.',
    'I am going to kill myself in the game.',
    'I am going to kill myself next year.',
    'I am going to kill myself if I lose this round.',
    "Could you translate 'I am going to kill myself'?",
    "What's a suicide prevention course?",
  ]) assert.equal(needsCurrentSelfHarmSupport(value), false, value)
})
