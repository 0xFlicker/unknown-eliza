export const USER_NAME = "Operator";
export const CHAT_SOURCE = "client_chat";
export const GROUP_CHAT_SOURCE = "client_group_chat";

export const AVATAR_IMAGE_MAX_SIZE = 300;

export enum FIELD_REQUIREMENT_TYPE {
  REQUIRED = "required",
  OPTIONAL = "optional",
}

export const FIELD_REQUIREMENTS = {
  name: FIELD_REQUIREMENT_TYPE.REQUIRED,
  username: FIELD_REQUIREMENT_TYPE.OPTIONAL,
  system: FIELD_REQUIREMENT_TYPE.REQUIRED,
  "settings.voice.model": FIELD_REQUIREMENT_TYPE.OPTIONAL,
  bio: FIELD_REQUIREMENT_TYPE.OPTIONAL,
  topics: FIELD_REQUIREMENT_TYPE.OPTIONAL,
  adjectives: FIELD_REQUIREMENT_TYPE.OPTIONAL,
  "style.all": FIELD_REQUIREMENT_TYPE.OPTIONAL,
  "style.chat": FIELD_REQUIREMENT_TYPE.OPTIONAL,
  "style.post": FIELD_REQUIREMENT_TYPE.OPTIONAL,
};
