import { TAKEOUT_NAME, TAKEOUT_TABLE_ID, type Catalog, type OptionGroup } from '../domain';

const spice: OptionGroup = {
  id: 'spice',
  name: '辣度',
  required: true,
  multiple: false,
  choices: [
    { id: 'spice-none', name: '不辣', priceDelta: 0 },
    { id: 'spice-mild', name: '小辣', priceDelta: 0 },
    { id: 'spice-hot', name: '大辣', priceDelta: 0 },
  ],
};
const noodleAddOns: OptionGroup = {
  id: 'noodle-addons',
  name: '加料',
  required: false,
  multiple: true,
  choices: [
    { id: 'addon-egg', name: '加滷蛋', priceDelta: 15 },
    { id: 'addon-noodle', name: '麵加大', priceDelta: 20 },
    { id: 'addon-beef', name: '加牛肉', priceDelta: 60 },
  ],
};
const riceSize: OptionGroup = {
  id: 'rice-size',
  name: '飯量',
  required: false,
  multiple: false,
  choices: [
    { id: 'rice-less', name: '飯少', priceDelta: 0 },
    { id: 'rice-more', name: '飯多', priceDelta: 10 },
  ],
};
const sugar: OptionGroup = {
  id: 'sugar',
  name: '甜度',
  required: true,
  multiple: false,
  choices: [
    { id: 'sugar-full', name: '正常糖', priceDelta: 0 },
    { id: 'sugar-half', name: '半糖', priceDelta: 0 },
    { id: 'sugar-none', name: '無糖', priceDelta: 0 },
  ],
};
const ice: OptionGroup = {
  id: 'ice',
  name: '冰塊',
  required: true,
  multiple: false,
  choices: [
    { id: 'ice-normal', name: '正常冰', priceDelta: 0 },
    { id: 'ice-less', name: '少冰', priceDelta: 0 },
    { id: 'ice-none', name: '去冰', priceDelta: 0 },
  ],
};

/** Record ids are fixed so that importing twice does not create duplicates. */
export const sampleCatalog: Catalog = {
  tables: [
    ...['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4'].map((name, index) => ({
      id: `table-${name}`,
      name,
      seats: index < 4 ? 2 : 4,
      sortOrder: index,
    })),
    { id: TAKEOUT_TABLE_ID, name: TAKEOUT_NAME, seats: 0, sortOrder: 100 },
  ],
  categories: [
    { id: 'cat-main', name: '主餐', sortOrder: 0 },
    { id: 'cat-side', name: '小菜', sortOrder: 1 },
    { id: 'cat-soup', name: '湯品', sortOrder: 2 },
    { id: 'cat-drink', name: '飲料', sortOrder: 3 },
  ],
  items: [
    { id: 'item-beef-noodle', categoryId: 'cat-main', name: '紅燒牛肉麵', price: 180, sortOrder: 0, optionGroups: [spice, noodleAddOns] },
    { id: 'item-dan-dan', categoryId: 'cat-main', name: '擔擔麵', price: 110, sortOrder: 1, optionGroups: [spice, noodleAddOns] },
    { id: 'item-pork-rice', categoryId: 'cat-main', name: '滷肉飯', price: 45, sortOrder: 2, optionGroups: [riceSize] },
    { id: 'item-chicken-rice', categoryId: 'cat-main', name: '雞腿飯', price: 130, sortOrder: 3, optionGroups: [riceSize] },
    { id: 'item-greens', categoryId: 'cat-side', name: '燙青菜', price: 40, sortOrder: 0, optionGroups: [] },
    { id: 'item-tofu', categoryId: 'cat-side', name: '皮蛋豆腐', price: 50, sortOrder: 1, optionGroups: [] },
    { id: 'item-kelp', categoryId: 'cat-side', name: '滷海帶', price: 30, sortOrder: 2, optionGroups: [] },
    { id: 'item-meatball-soup', categoryId: 'cat-soup', name: '貢丸湯', price: 35, sortOrder: 0, optionGroups: [] },
    { id: 'item-clam-soup', categoryId: 'cat-soup', name: '蛤蜊湯', price: 60, sortOrder: 1, optionGroups: [] },
    { id: 'item-black-tea', categoryId: 'cat-drink', name: '紅茶', price: 30, sortOrder: 0, optionGroups: [sugar, ice] },
    { id: 'item-winter-melon', categoryId: 'cat-drink', name: '冬瓜茶', price: 30, sortOrder: 1, optionGroups: [ice] },
    { id: 'item-beer', categoryId: 'cat-drink', name: '台灣啤酒', price: 70, sortOrder: 2, optionGroups: [] },
  ],
};
