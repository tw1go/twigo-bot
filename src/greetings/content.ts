// Edit freely — one entry per line. Items rotate without repeats until each list is used up.

export const greetings = [
  'Gising na ba ang mga tanod?',
  'Oh, ronda na mga tanod!',
  'Nagpapatrol na ba ang ating mga huwarang tanod?',
  'Magandang umaga, mga ka-tanod!',
  'Rise and shine, barangay!',
  'Kape muna bago ronda! ☕',
  'Good morning, mga idol! Bangon na!',
  'Tanod check! Sino na ang gising?',
  'Umaga na! Tara, simulan na natin ang araw!',
  'Good morning! Huwag kalimutang mag-almusal bago mag-patrol!',
];

export const jokes = [
  'Teacher: Juan, bakit ka late?\nJuan: Ma\'am, sabi po kasi sa karatula, "School ahead, go slow."',
  'Doktor: Kailangan mong iwasan ang stress.\nPasyente: Doc, pwede po bang iwasan din ang Lunes?',
  'Bakit malungkot ang kalendaryo? Kasi bilang na ang mga araw niya. 📅',
  'Why did the coffee file a police report? It got mugged. ☕',
  'Why is the corner of a room always cold? Kasi 90 degrees. 🥶',
  'Why can\'t a sleeping tanod lie? Because he\'s already lying down. 😴',
  'Why don\'t eggs tell jokes? They\'d crack each other up. 🥚',
  'What do you call a fake noodle? An impasta. 🍝',
  'Why can\'t you trust atoms? They make up everything. ⚛️',
  'Why did the scarecrow win an award? He was outstanding in his field. 🌾',
  'Why did the bicycle fall over? It was two-tired. 🚲',
  'What do you call a bear with no teeth? A gummy bear. 🐻',
  'What did the ocean say to the beach? Nothing, it just waved. 🌊',
  'Why do cows wear bells? Because their horns don\'t work. 🐄',
  'I told my friend she drew her eyebrows too high. She looked surprised. 🤨',
];

export const sweetMessages = [
  'Kahit gaano kahirap ang kahapon, bagong simula ang bawat umaga. Kaya mo \'yan! 💪',
  'Salamat sa pagiging bahagi ng barangay na ito. Mas masaya dahil nandito ka. 💛',
  'Uminom ng tubig, kumain ng almusal, at huwag kalimutang ngumiti ngayong araw. 😊',
  'You are doing better than you think. Keep going! 🌻',
  'Small progress is still progress. Proud of you! ✨',
  'Sana maging magaan ang araw mo ngayon at puno ng good vibes! ☀️',
  'Be kind to yourself today. You deserve it. 💖',
  'Your presence makes this server a better place. Have a wonderful day! 🌈',
  'Hindi kailangang perpekto ang araw para maging masaya. Enjoy the little things! 🍞☕',
  'May mga taong nagpapasalamat na kilala ka. Isa na kami doon. 🤗',
  'Today is a good day to have a good day. 🌞',
  'Pahinga kung pagod, pero huwag susuko. Laban lang! 🔥',
];

export const trivia = [
  'The Philippines has **7,641 islands** — 107 more than previously counted, after a 2016 NAMRIA survey. 🏝️',
  'Each eye of the **Philippine tarsier** is about as big as its entire brain. 👀',
  'The **yo-yo** became a craze in the US thanks to Pedro Flores, a Filipino immigrant who started mass-producing them in the 1920s. 🪀',
  '**Mount Apo** in Mindanao is the highest mountain in the Philippines, at about 2,954 meters. ⛰️',
  'The **Philippine eagle**, our national bird, is one of the largest eagles in the world. 🦅',
  'The **Chocolate Hills** of Bohol number more than 1,200 hills. 🍫',
  'The first **jeepneys** were built from US military jeeps left behind after World War II. 🚙',
  'Octopuses have **three hearts** and blue blood. 🐙',
  'Honey never spoils — edible honey has been found in ancient Egyptian tombs. 🍯',
  'Botanically, **bananas are berries**, but strawberries are not. 🍌',
  'Sea otters hold hands while sleeping so they don\'t drift apart. 🦦',
  'A day on **Venus** is longer than its year. 🪐',
  'Wombat poop is **cube-shaped**. 🟫',
  '**Sharks** existed before trees did. 🦈🌳',
  'Butterflies taste with their **feet**. 🦋',
  'The shortest war in history, the Anglo-Zanzibar War of 1896, lasted under an hour. ⏱️',
  'Koalas have fingerprints so similar to humans\' they can be hard to tell apart. 🐨',
  'The Eiffel Tower can grow about 15 cm taller in summer because metal expands in the heat. 🗼',
];

export const categories = {
  joke: { title: '😂 Joke of the day', items: jokes },
  sweet: { title: '💌 Message for you', items: sweetMessages },
  trivia: { title: '🧠 Did you know?', items: trivia },
} as const;

export type Category = keyof typeof categories;
