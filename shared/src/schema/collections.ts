import type { z } from 'zod';
import { Person, User } from './person.js';
import { Place, PlaceSubtype } from './place.js';
import { PlaceItem, VisitItem } from './item.js';
import { Visit } from './visit.js';
import { Rating } from './rating.js';
import { Note } from './note.js';
import { Photo } from './photo.js';
import { Menu } from './menu.js';
import { Draft, VoiceNote } from './voice.js';
import { UserSettings } from './settings.js';

/** Every synced collection and the schema its records must satisfy. */
export const collectionSchemas = {
  users: User,
  people: Person,
  places: Place,
  placeSubtypes: PlaceSubtype,
  placeItems: PlaceItem,
  visits: Visit,
  visitItems: VisitItem,
  ratings: Rating,
  notes: Note,
  photos: Photo,
  menus: Menu,
  voiceNotes: VoiceNote,
  drafts: Draft,
  userSettings: UserSettings,
} as const satisfies Record<string, z.ZodType>;

export type CollectionName = keyof typeof collectionSchemas;
export const collectionNames = Object.keys(collectionSchemas) as CollectionName[];

/** Singular type name per collection (used for generated API types). */
export const recordTypeNames: Record<CollectionName, string> = {
  users: 'User',
  people: 'Person',
  places: 'Place',
  placeSubtypes: 'PlaceSubtype',
  placeItems: 'PlaceItem',
  visits: 'Visit',
  visitItems: 'VisitItem',
  ratings: 'Rating',
  notes: 'Note',
  photos: 'Photo',
  menus: 'Menu',
  voiceNotes: 'VoiceNote',
  drafts: 'Draft',
  userSettings: 'UserSettings',
};
