/**
 * Permissions grouped by known modules and user-defined modules.
 */
export type GlobalPermissions = {
    churchcal?: {
        'admin church category': boolean;
        'admin group category': boolean;
        'admin personal category': boolean;
        'assistance mode': boolean;
        'create group category': boolean;
        'create personal category': boolean;
        'edit calendar entry template': Array<number>;
        'edit category': Array<number>;
        view: boolean;
        'view category': Array<number>;
    };
    churchcheckin?: {
        'create person': boolean;
        'edit masterdata': boolean;
        view: boolean;
    };
    churchcore?: {
        'administer church html templates': boolean;
        'administer custom modules'?: boolean;
        'administer persons': boolean;
        'administer settings': boolean;
        'edit languages': Array<number>;
        'edit public profiles': boolean;
        'edit translations masterdata': boolean;
        'edit website releases': boolean;
        'edit website staff': boolean;
        'invite persons': boolean;
        'login to external system': Array<number>;
        'simulate persons': boolean;
        'use church html templates': Array<number>;
        'use churchquery'?: boolean;
        'view logfile': boolean;
        'view website': boolean;
    };
    churchdb?: {
        'administer global filters': boolean;
        /**
         * @deprecated
         */
        'administer groups': boolean;
        'complex filter': boolean;
        /**
         * @deprecated
         */
        'create groups of grouptype': Array<number>;
        'create person': boolean;
        'create print labels': boolean;
        /**
         * @deprecated
         */
        'delete group': Array<number>;
        /**
         * @deprecated
         */
        'delete groups of grouptype': Array<number>;
        'delete persons': boolean;
        'edit bulkletter': boolean;
        /**
         * @deprecated
         */
        'edit group': Array<number>;
        'edit group memberships': boolean;
        /**
         * @deprecated
         */
        'edit group memberships of group': Array<number>;
        /**
         * @deprecated
         */
        'edit group memberships of grouptype': Array<number>;
        /**
         * @deprecated
         */
        'edit groups of grouptype': Array<number>;
        'edit masterdata': boolean;
        'edit relations': boolean;
        'export data': boolean;
        'push/pull archive': boolean;
        'security level edit own data': Array<number>;
        /**
         * @deprecated
         */
        'security level group': Array<number>;
        'security level person': Array<number>;
        'security level view own data': Array<number>;
        'send sms': boolean;
        view: boolean;
        'view alldata': Array<number>;
        'view archive': boolean;
        'view birthdaylist': boolean;
        'view comments': Array<number>;
        /**
         * @deprecated
         */
        'view group': Array<number>;
        /**
         * @deprecated
         */
        'view groups of grouptype': Array<number>;
        'view memberliste': boolean;
        'view person history': boolean;
        'view person tags': boolean;
        'view station': Array<number>;
        'view statistics': boolean;
        /**
         * @deprecated
         */
        'view tags': boolean;
        'write access': boolean;
    };
    churchgroup?: {
        'administer global views': boolean;
        'administer groups': boolean;
        'create groups of grouptype': Array<number>;
        'delete group': Array<number>;
        'delete groups of grouptype': Array<number>;
        'edit group': Array<number>;
        'edit group memberships of group': Array<number>;
        'edit group memberships of grouptype': Array<number>;
        'edit groups of grouptype': Array<number>;
        'edit masterdata': boolean;
        'security level group': Array<number>;
        view: boolean;
        'view group': Array<number>;
        'view group history': boolean;
        'view group tags': boolean;
        'view groups of grouptype': Array<number>;
    };
    churchreport?: {
        'edit masterdata': boolean;
        view: boolean;
        'view query': Array<number>;
    };
    churchresource?: {
        'administer bookings': Array<number>;
        'assistance mode': boolean;
        'create bookings': Array<number>;
        'create virtual bookings': boolean;
        'edit masterdata': boolean;
        view: boolean;
        'view resource': Array<number>;
    };
    churchservice?: {
        'edit agenda': Array<number>;
        'edit agenda templates': Array<number>;
        'edit events': Array<number>;
        'edit fact': Array<number>;
        'edit masterdata': boolean;
        'edit servicegroup': Array<number>;
        'edit songcategory': Array<number>;
        'edit template': boolean;
        'export facts': boolean;
        'manage absent': boolean;
        'use ccli': boolean;
        view: boolean;
        'view agenda': Array<number>;
        'view events': Array<number>;
        'view fact': Array<number>;
        'view history': boolean;
        'view servicegroup': Array<number>;
        'view song statistics': boolean;
        'view songcategory': Array<number>;
    };
    churchsync?: {
        view: boolean;
    };
    churchwiki?: {
        'edit category': Array<number>;
        'edit masterdata': boolean;
        view: boolean;
        'view category': Array<number>;
    };
    finance?: {
        'edit accounting period': Array<number>;
        'edit masterdata': boolean;
        view: boolean;
        'view accounting period': Array<number>;
    };
    post?: {
        'moderate posts': boolean;
    };
    [key: string]:
        | CustomModulePermission
        | {
              'admin church category': boolean;
              'admin group category': boolean;
              'admin personal category': boolean;
              'assistance mode': boolean;
              'create group category': boolean;
              'create personal category': boolean;
              'edit calendar entry template': Array<number>;
              'edit category': Array<number>;
              view: boolean;
              'view category': Array<number>;
          }
        | {
              'create person': boolean;
              'edit masterdata': boolean;
              view: boolean;
          }
        | {
              'administer church html templates': boolean;
              'administer custom modules'?: boolean;
              'administer persons': boolean;
              'administer settings': boolean;
              'edit languages': Array<number>;
              'edit public profiles': boolean;
              'edit translations masterdata': boolean;
              'edit website releases': boolean;
              'edit website staff': boolean;
              'invite persons': boolean;
              'login to external system': Array<number>;
              'simulate persons': boolean;
              'use church html templates': Array<number>;
              'use churchquery'?: boolean;
              'view logfile': boolean;
              'view website': boolean;
          }
        | {
              'administer global filters': boolean;
              /**
               * @deprecated
               */
              'administer groups': boolean;
              'complex filter': boolean;
              /**
               * @deprecated
               */
              'create groups of grouptype': Array<number>;
              'create person': boolean;
              'create print labels': boolean;
              /**
               * @deprecated
               */
              'delete group': Array<number>;
              /**
               * @deprecated
               */
              'delete groups of grouptype': Array<number>;
              'delete persons': boolean;
              'edit bulkletter': boolean;
              /**
               * @deprecated
               */
              'edit group': Array<number>;
              'edit group memberships': boolean;
              /**
               * @deprecated
               */
              'edit group memberships of group': Array<number>;
              /**
               * @deprecated
               */
              'edit group memberships of grouptype': Array<number>;
              /**
               * @deprecated
               */
              'edit groups of grouptype': Array<number>;
              'edit masterdata': boolean;
              'edit relations': boolean;
              'export data': boolean;
              'push/pull archive': boolean;
              'security level edit own data': Array<number>;
              /**
               * @deprecated
               */
              'security level group': Array<number>;
              'security level person': Array<number>;
              'security level view own data': Array<number>;
              'send sms': boolean;
              view: boolean;
              'view alldata': Array<number>;
              'view archive': boolean;
              'view birthdaylist': boolean;
              'view comments': Array<number>;
              /**
               * @deprecated
               */
              'view group': Array<number>;
              /**
               * @deprecated
               */
              'view groups of grouptype': Array<number>;
              'view memberliste': boolean;
              'view person history': boolean;
              'view person tags': boolean;
              'view station': Array<number>;
              'view statistics': boolean;
              /**
               * @deprecated
               */
              'view tags': boolean;
              'write access': boolean;
          }
        | {
              'administer global views': boolean;
              'administer groups': boolean;
              'create groups of grouptype': Array<number>;
              'delete group': Array<number>;
              'delete groups of grouptype': Array<number>;
              'edit group': Array<number>;
              'edit group memberships of group': Array<number>;
              'edit group memberships of grouptype': Array<number>;
              'edit groups of grouptype': Array<number>;
              'edit masterdata': boolean;
              'security level group': Array<number>;
              view: boolean;
              'view group': Array<number>;
              'view group history': boolean;
              'view group tags': boolean;
              'view groups of grouptype': Array<number>;
          }
        | {
              'edit masterdata': boolean;
              view: boolean;
              'view query': Array<number>;
          }
        | {
              'administer bookings': Array<number>;
              'assistance mode': boolean;
              'create bookings': Array<number>;
              'create virtual bookings': boolean;
              'edit masterdata': boolean;
              view: boolean;
              'view resource': Array<number>;
          }
        | {
              'edit agenda': Array<number>;
              'edit agenda templates': Array<number>;
              'edit events': Array<number>;
              'edit fact': Array<number>;
              'edit masterdata': boolean;
              'edit servicegroup': Array<number>;
              'edit songcategory': Array<number>;
              'edit template': boolean;
              'export facts': boolean;
              'manage absent': boolean;
              'use ccli': boolean;
              view: boolean;
              'view agenda': Array<number>;
              'view events': Array<number>;
              'view fact': Array<number>;
              'view history': boolean;
              'view servicegroup': Array<number>;
              'view song statistics': boolean;
              'view songcategory': Array<number>;
          }
        | {
              view: boolean;
          }
        | {
              'edit category': Array<number>;
              'edit masterdata': boolean;
              view: boolean;
              'view category': Array<number>;
          }
        | {
              'edit accounting period': Array<number>;
              'edit masterdata': boolean;
              view: boolean;
              'view accounting period': Array<number>;
          }
        | {
              'moderate posts': boolean;
          }
        | undefined;
};


/**
 * A permission object for a specific custom module.
 */
export type CustomModulePermission = {
    'create custom category': boolean;
    'create custom data': Array<number>;
    'delete custom category': Array<number>;
    'delete custom data': Array<number>;
    'edit custom category': Array<number>;
    'edit custom data': Array<number>;
    view: boolean;
    'view custom category': Array<number>;
    'view custom data': Array<number>;
};
