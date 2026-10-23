/* Seed data, taken from the "[DFL] Questions for the parent and child street interview" document.
   Section "max" = how many questions Shuffle suggests from that section. */
window.SEED = {
  pretext:
    'Ask the kid and the parent which of them games. If both game, each answers from their own perspective. ' +
    'If only the kid games, the parent tries to guess the kid\'s answer. Same answer = 1 point.',

  sections: [
    { id: 's_warm',   stage: 'rapid', name: 'Warm-up',          hint: 'A or B. Both answer together on 3-2-1.', max: 2 },
    { id: 's_point',  stage: 'rapid', name: 'Gaming habits',    hint: 'Both point at the person on 3-2-1.',     max: 2 },
    { id: 's_know',   stage: 'rapid', name: 'Gaming knowledge', hint: 'Short answers. Parent may guess.',        max: 2 },
    { id: 's_habits', stage: 'long',  name: 'Gaming habits',    hint: 'Open question. No points, no wrong answers.', max: 1 },
    { id: 's_digital',stage: 'long',  name: 'Digital literacy', hint: 'Keep it calm and practical.',             max: 2 },
    { id: 's_play',   stage: 'long',  name: 'Power of play',    hint: 'Warm, slower. Good closer.',              max: 1 }
  ],

  questions: [
    // Rapid fire: warm-up
    { id: 'q_01', sectionId: 's_warm', text: 'Mobile or console?', answer: '' },
    { id: 'q_02', sectionId: 's_warm', text: 'Play solo or with friends?', answer: '' },
    { id: 'q_03', sectionId: 's_warm', text: 'Main or support?', answer: '' },
    { id: 'q_04', sectionId: 's_warm', text: 'Grind or chill?', answer: '' },
    { id: 'q_05', sectionId: 's_warm', text: 'Build or battle?', answer: '' },
    { id: 'q_06', sectionId: 's_warm', text: 'Win or have fun?', answer: '' },

    // Rapid fire: gaming habits (point at the person)
    { id: 'q_07', sectionId: 's_point', text: 'Who\'s better at games: Mom/Dad or kid?', answer: '' },
    { id: 'q_08', sectionId: 's_point', text: 'Who gets more competitive?', answer: '' },
    { id: 'q_09', sectionId: 's_point', text: 'Who is a better teammate?', answer: '' },
    { id: 'q_10', sectionId: 's_point', text: 'Who is more likely to rage quit?', answer: '' },
    { id: 'q_11', sectionId: 's_point', text: 'Who is more likely to say "one more round"?', answer: '' },

    // Rapid fire: gaming general knowledge
    { id: 'q_12', sectionId: 's_know', text: 'What do you call a character controlled by the computer that you can\'t play as?', answer: 'NPC (non-player character)' },
    { id: 'q_13', sectionId: 's_know', text: 'What do you call someone who is new and inexperienced at a game?', answer: 'Noob' },
    { id: 'q_14', sectionId: 's_know', text: 'What does AFK mean?', answer: 'Away from keyboard' },
    { id: 'q_15', sectionId: 's_know', text: 'What\'s OP?', answer: 'Overpowered' },
    { id: 'q_16', sectionId: 's_know', text: 'What does Tank mean?', answer: 'A sturdy character who soaks up damage to protect teammates' },
    { id: 'q_17', sectionId: 's_know', text: 'What is a whaler?', answer: 'Someone who spends a lot of money on in-app purchases' },
    { id: 'q_18', sectionId: 's_know', text: 'What is a buff and what is a nerf?', answer: 'A buff makes a character/weapon/game element stronger; a nerf weakens it to keep the game fair.' },
    { id: 'q_19', sectionId: 's_know', text: 'What does farming mean?', answer: 'Repeating the same task, enemies or areas to collect resources, currency, items or experience.' },
    { id: 'q_20', sectionId: 's_know', text: 'What does "the meta" mean in gaming?', answer: 'The dominant tactics and popular team compositions at any given time.' },

    // Longer Q&A
    { id: 'q_21', sectionId: 's_habits', text: 'Whom do you play games with?', answer: '' },
    { id: 'q_22', sectionId: 's_habits', text: 'Do you tend to play with people you have already known in real life?', answer: '' },
    { id: 'q_23', sectionId: 's_habits', text: 'How much playtime do you think is reasonable?', answer: '' },

    { id: 'q_24', sectionId: 's_digital', text: 'How do you define a "troll"? How do you deal with them?', answer: '' },
    { id: 'q_25', sectionId: 's_digital', text: 'What should you do when someone in the game asks you to add them off-platform?', answer: '' },
    { id: 'q_26', sectionId: 's_digital', text: 'Someone offers cheap skins from an unverified source. Do you think it\'s a good deal?', answer: '' },

    { id: 'q_27', sectionId: 's_play', text: 'Describe your ideal family game night.', answer: '' },
    { id: 'q_28', sectionId: 's_play', text: 'What game would you create for your parent/kid?', answer: '' }
  ]
};
