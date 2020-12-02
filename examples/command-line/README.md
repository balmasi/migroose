### Example of using the CLI

After running `npm install migrate-mongoose`, you will have the migration binary available to you as `./node_modules/.bin/migrate`.


##### Creating a Migration
You can simply create a new migration (e.g. `my_new_migration`) by running

```
$ ./node_modules/.bin/migrate <options> create my_new_migration
```

where `<options>` must at a MINIMUM contain the database url (using the `-d`/`--dbConnectionUri` option).

You can use custom template file for creating new migrations (using the `-t`/`--template-file` option). Migration file will be created with the same extension as template file.

##### Listing Migrations

This shows you the migrations with their current states.

*DOWN* means the migrations has not been run yet
*UP* means the migration has run and won't be running again

```
$ ./node_modules/.bin/migrate <options> list
```

##### Running a Migration (Migrate UP)

Let's say your `migrate list` command shows

```
UP:  	  1450107140857-user-credit-to-vault.js
UP:  	  1452541801404-user-default-billing-to-default-billing-incoming.js
UP:  	  1461351953091-add_inventory.js
DOWN:	  1463003345598-add_processed_credit_cards.js
DOWN:  	  1463603842010-add_default_regional_settings.js
```

This means the first 3 migrations have run. You need to run the next 2 to be all up to date with the latest schema/data changes made by other developers.

simply run


```
$ ./node_modules/.bin/migrate <options> up add_default_regional_settings
```

To migrate *UP TO (and including)*  `1463603842010-add_default_regional_settings.js`

Your new state will be

```
UP:  	  1450107140857-user-credit-to-vault.js
UP:  	  1452541801404-user-default-billing-to-default-billing-incoming.js
UP:  	  1461351953091-add_inventory.js
UP:	  1463003345598-add_processed_credit_cards.js
UP:  	  1463603842010-add_default_regional_settings.js
```

##### Undoing Migrations (Migrate DOWN)

What if you want to undo the previous step?

Simply run

```
$ ./node_modules/.bin/migrate <options> down add_processed_credit_cards
```

and you'll migrate *DOWN TO (and including)* `1463003345598-add_processed_credit_cards.js`

Your new state will be

```
UP:  	  1450107140857-user-credit-to-vault.js
UP:  	  1452541801404-user-default-billing-to-default-billing-incoming.js
UP:  	  1461351953091-add_inventory.js
DOWN:	  1463003345598-add_processed_credit_cards.js
DOWN:  	  1463603842010-add_default_regional_settings.js
```


##### Synchronizing Your DB with new Migrations

Lets say you `git pull` the latest changes from your project and someone had made a new migration called `add_unicorns` which adds much requested unicorns to your app.

Now, when you go run any migration command (e.g. `migrate list`), you are prompted with

```
Synchronizing database with file system migrations...
? The following migrations exist in the migrations folder but not in the database. Select the ones you want to import into the database (Press <space> to select)
❯◯ 1463003339853-add_unicorns.js
```
This is telling you that someone added a migration file that's your database doesn't have yet.
If you select it by pressing **Space** then **Enter** on your keyboard, you can tell `migrate-mongoose` to import it into the database.

Once imported, the default state is DOWN so you'll have to `migrate up add_unicorns` to be all up-to-date.

**IF ON THE OTHER HAND** you don't want this migration, simply run

```
$ ./node_modules/.bin/migrate prune
```

and you'll be prompted to remove it from the **FILE SYSTEM**.



###### But what happens if I want to sync automatically instead of doing this every time?

just add the option `--autosync` and the migrate command will automaticalaly import new migrations in your migrations folder before running commands.
