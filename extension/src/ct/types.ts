/** The rights of the current person on the extension's module (`GET /permissions/global` → `data[<key>]`). */
export interface Permissions {
    view: boolean;
    'create custom category': boolean;
    /** The following are lists of category IDs. Missing rights are `[]`, never missing keys. */
    'view custom category': number[];
    'edit custom category': number[];
    'delete custom category': number[];
    'view custom data': number[];
    'create custom data': number[];
    'edit custom data': number[];
    'delete custom data': number[];
}

export interface CtWhoAmI {
    id: number;
    firstName: string;
    lastName: string;
}

export interface CtCategory {
    id: number;
    name: string;
    shorty: string;
}

/** `value` is a JSON string; parsing and validating it is the store layer's job. */
export interface CtValue {
    id: number;
    dataCategoryId: number;
    value: string;
}

export interface CtGroup {
    id: number;
    name: string;
    memberCount: number;
}
