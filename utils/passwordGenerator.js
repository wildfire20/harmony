const crypto = require('crypto');

const adjectives = [
  'Happy', 'Sunny', 'Brave', 'Clever', 'Swift', 'Bright', 'Lucky', 'Mighty',
  'Golden', 'Silver', 'Rainbow', 'Starry', 'Cosmic', 'Super', 'Magic', 'Royal',
  'Gentle', 'Jolly', 'Merry', 'Peachy', 'Rosy', 'Shiny', 'Snowy', 'Sparkly',
  'Tender', 'Warm', 'Wise', 'Zesty', 'Fluffy', 'Cozy', 'Dreamy', 'Fancy',
  'Giggle', 'Jumpy', 'Peppy', 'Perky', 'Silly', 'Smiley', 'Twinkle', 'Wiggly',
  'Bouncy', 'Bubbly', 'Candy', 'Cherry', 'Cookie', 'Doodle', 'Fizzy', 'Frosty',
  'Glitter', 'Honey', 'Jazzy', 'Jelly', 'Lemon', 'Maple', 'Minty', 'Pickle',
  'Puddle', 'Pumpkin', 'Sprinkle', 'Sugar', 'Sunny', 'Toffee', 'Vanilla', 'Waffle'
];

const animals = [
  'Lion', 'Tiger', 'Bear', 'Eagle', 'Dolphin', 'Penguin', 'Koala', 'Panda',
  'Rabbit', 'Turtle', 'Elephant', 'Giraffe', 'Monkey', 'Zebra', 'Kangaroo',
  'Owl', 'Fox', 'Wolf', 'Deer', 'Duck', 'Swan', 'Horse', 'Dragon', 'Phoenix',
  'Unicorn', 'Kitten', 'Puppy', 'Bunny', 'Hamster', 'Parrot', 'Peacock', 'Falcon',
  'Cheetah', 'Leopard', 'Panther', 'Jaguar', 'Rhino', 'Hippo', 'Gorilla', 'Chimp',
  'Otter', 'Beaver', 'Squirrel', 'Hedgehog', 'Badger', 'Raccoon', 'Flamingo', 'Toucan',
  'Hummingbird', 'Butterfly', 'Ladybug', 'Firefly', 'Starfish', 'Seahorse', 'Octopus',
  'Jellyfish', 'Crab', 'Lobster', 'Salmon', 'Whale', 'Shark', 'Manta', 'Clownfish'
];

const colors = [
  'Red', 'Blue', 'Green', 'Yellow', 'Orange', 'Purple', 'Pink', 'Gold',
  'Silver', 'White', 'Black', 'Brown', 'Gray', 'Cyan', 'Magenta', 'Teal',
  'Coral', 'Crimson', 'Indigo', 'Lavender', 'Lime', 'Maroon', 'Navy', 'Olive',
  'Peach', 'Plum', 'Rose', 'Ruby', 'Scarlet', 'Sky', 'Tan', 'Violet'
];

const objects = [
  'Star', 'Moon', 'Sun', 'Cloud', 'Rainbow', 'Thunder', 'Lightning', 'Storm',
  'River', 'Mountain', 'Ocean', 'Forest', 'Garden', 'Flower', 'Tree', 'Leaf',
  'Stone', 'Crystal', 'Diamond', 'Pearl', 'Ruby', 'Emerald', 'Sapphire', 'Opal',
  'Crown', 'Shield', 'Sword', 'Arrow', 'Castle', 'Tower', 'Bridge', 'Gate',
  'Rocket', 'Comet', 'Planet', 'Galaxy', 'Nebula', 'Aurora', 'Blizzard', 'Breeze',
  'Bubble', 'Button', 'Cookie', 'Cupcake', 'Donut', 'Muffin', 'Pretzel', 'Waffle'
];

function getRandomItem(array) {
  return array[crypto.randomInt(0, array.length)];
}

function getRandomNumber(min, max) {
  return crypto.randomInt(min, max + 1);
}

function generateKidFriendlyPassword() {
  const prefix = `${getRandomItem(adjectives)}${getRandomItem(animals)}`;
  const randomPart = crypto.randomBytes(9).toString('base64url');
  return `${prefix}-${randomPart}!${getRandomNumber(10, 99)}`;
}

function generatePasswordForUser() {
  return generateKidFriendlyPassword();
}

module.exports = {
  generateKidFriendlyPassword,
  generatePasswordForUser
};
