"use strict";
const [DB, fs, lib, web, logins] = plugin.importMany("DB", "fs", "lib", "web", "logins"),
	pastaDB = new DB.Json({filename: "pastas"});

function formatOutput(tmpl, obj) {
	return tmpl.replace(/\{\{([^\{\} ]+)\}\}/g, function (a, b) {
		return obj[b];
	});
}

function isGoodPath(p) {
	return /^[a-zA-Z0-9#]+$/.test(p) && p.length <= 20;
}

function constructPath(target, list, type) {
	if (config.pasta_path.slice(-1) !== "/")
		return config.pasta_path+"/"+type+"/"+target+"/"+list+".html";
	return config.pasta_path+type+"/"+target+"/"+list+".html";
}

function writeList(user, list, type, tpl) {
	let obj = {
			target: type === "c" ? "#"+user.target : user.target,
			list: list,
			data: user.lists[list].sort(function (a, b) {
				return a.name.toLocaleString().toLowerCase().localeCompare(b.name.toLocaleString().toLowerCase());
			}).map(function (item) {
				return "<li><a href='"+(item.link ? item.link : "#")+"'>"+item.name+"</a></li>";
			}).join("\n")
		},
		template = fs.readFileSync("data/www/templates/" + tpl + ".html").toString(),
		target = user.target.toLowerCase(),
		path = "data/www/"+type+"/"+target+"/";
	lib.fs.makePath(path);
	try {
		fs.writeFileSync(path+list+".html", formatOutput(template, obj));
		return constructPath(target, list, type)+" was updated.";
	} catch (e) {
		logger.error("Couldn't write "+path+list+".html:", e, e);
		return "Couldn't write the file for some reason. :\\";
	}
}

function deleteList(user, list, type) {
	let path = "data/www/"+type+"/"+user.target+"/"+list+".html";
	if (fs.existsSync(path)) {
		try {
			fs.unlinkSync(path);
			logger.info("Deleted "+path);
		} catch (e) {
			logger.error("Couldn't delete "+path+": "+e, e);
		}
	}
}

function createList(target, list, tpl) {
	let user;
	if (!isGoodPath(list))
		return "Bad list name. Lists should be letters and numbers only and no longer than 20 characters.";
	user = pastaDB.getOne(target);
	if (!user)
		user = { lists: {} };
	if (user.lists[list] !== undefined)
		return "That list exists already.";
	user.target = target;
	user.template = tpl;
	user.lists[list] = [];
	pastaDB.saveOne(target, user);
	return "Created. o7";
}

function listIndexOf(list, item) {
	let i, lowerItem = item.toLowerCase();
	for (i = 0; i < list.length; i++)
		if (list[i].name.toLowerCase() === lowerItem)
			return i;
	return -1;
}

function listContains(list, item) {
	return listIndexOf(list, item) > -1;
}

function addListItem(context, target, list, item, type) {
	let gReg, linkReg, user;

	if (!isGoodPath(list))
		return "Bad list name. Lists should be letters and numbers only and no longer than 20 characters.";
	user = pastaDB.getOne(target) || {};
	user.lists = user.lists || {};
	user.lists[list] = user.lists[list] || [];
	user.target = target;
	user.template = user.template || "list";
	gReg = /^(.*) (google|bing) (site:[^ ]+)/i.exec(item);
	if (gReg) {
		if (listContains(user.lists[list], gReg[1])) {
			irc.say(context, "That's already on the list.");
			return;
		}
		gReg[2] = gReg[2].toLowerCase();
		web[gReg[2]](gReg[1]+" "+gReg[3]).then(function (resp) {
			user.lists[list].push({
				name: gReg[1],
				link: resp[0].url
			});
			pastaDB.saveOne(target, user);
			irc.say(context, writeList(user, list, type, user.template));
		}, function () {
			irc.say(context, "Google didn't find '"+gReg[1]+"' on "+gReg[3].slice(5));
		});
		return;
	}
	linkReg = /^(.*) (https?:\/\/[^ ]+\.[^ ]+)/.exec(item);
	if (linkReg)
		item = { name: linkReg[1], link: linkReg[2] };
	else
		item = { name: item, link: "#" };
	if (listContains(user.lists[list], item.name)) {
		irc.say(context, "That's already on the list.");
		return;
	}
	user.lists[list].push(item);
	pastaDB.saveOne(target, user);
	irc.say(context, writeList(user, list, type, user.template));
}

function changeListItem(target, list, item, newLink, type) {
	let index, user = pastaDB.getOne(target);
	if (!user || !user.lists || !user.lists[list])
		return "There is no such list.";
	if ((index = listIndexOf(user.lists[list], item)) === -1)
		return "That's not on the list.";
	user.lists[list][index].link = newLink;
	pastaDB.saveOne(target, user);
	return writeList(user, list, type, user.template);
}

function remListItem(target, list, item, type) {
	let i, user;
	if (!isGoodPath(list))
		return "Bad list name. Lists should be letters and numbers only and no longer than 20 characters.";
	user = pastaDB.getOne(target);
	if (!user || !user.lists || !user.lists[list] || !user.lists[list].length)
		return "There is no such list.";
	item = item.toLowerCase();
	for (i = 0; i < user.lists[list].length; i++) {
		if (user.lists[list][i].name.toLowerCase() === item) {
			user.lists[list].splice(i, 1);
			user.target = target;
			pastaDB.saveOne(target, user);
			return writeList(user, list, type, user.template);
		}
	}
	return "Couldn't find it.";
}

function pastaCmd(input) {
	let type, user, list, target, cmd, hReg, template;
	if (config.pasta_path === undefined) {
		irc.say(input.context, "The 'pasta path' config option isn't set. This wont work without that. See config.example");
		return;
	}
	cmd = input.command;
	if (cmd === "ulist") {
		target = input.nick.toLowerCase();
		type = "u";
	} else {
		target = input.context.toLowerCase().slice(1);
		type = "c";
	}
	if (input.args[1])
		list = input.args[1].toLowerCase();
	if (input.args[2]) {
		template = input.args[2].toLowerCase();
	}
	else {
		template = "list";
	}
	switch (input.args[0]) {
	case "create": // create a list
		if (!input.args[1]) {
			irc.say(input.context, "[Help] Syntax: "+config.command_prefix+cmd+" create <list> [template]");
			break;
		}
		irc.say(input.context, createList(target, list, template));
		break;
	case "add": // add list <line>
		if (input.args.length < 3) {
			irc.say(input.context, "[Help] Syntax: "+config.command_prefix+cmd+" add <list> <entry>");
			break;
		}
		addListItem(input.context, target, list, input.args.slice(2).join(" "), type);
		break;
	case "remove":
		if (input.args.length < 3) {
			irc.say(input.context, "[Help] Syntax: "+config.command_prefix+cmd+" remove <list> <entry> "+
				"- You can only remove one at a time.");
			break;
		}
		irc.say(input.context, remListItem(target, list, input.args.slice(2).join(" "), type));
		break;
	case "relink": // clist relink list entry http://link.here
		if (input.args.length < 4 || (hReg = /(.*) (https?:\/\/[^ ]+)/i.exec(input.args.slice(2).join(" "))) === null) {
			irc.say(input.context, "[Help] Syntax: "+config.command_prefix+cmd+" relink <list> <list item> <new link>");
			break;
		}
		irc.say(input.context, changeListItem(target, list, hReg[1], hReg[2], type));
		break;
	case "refresh":
		if (input.args.length < 2) {
			irc.say(input.context, "[Help] Syntax: "+config.command_prefix+cmd+" refresh <list>");
			break;
		}
		user = pastaDB.getOne(target);
		if (!user || !user.lists || !user.lists[list]) {
			irc.say(input.context, "There is no such list.");
			break;
		}
		irc.say(input.context, writeList(user, list, type, user.template));
		break;
	case "delete":
		if (input.args.length < 2) {
			irc.say(input.context, "[Help] Syntax: "+config.command_prefix+cmd+" delete <list>");
			break;
		}
		if (type === "c" && !logins.isAdmin(input.nick)) {
			irc.say(input.context, "Only Admins may remove channel lists.");
			break;
		}
		user = pastaDB.getOne(target);
		if (!user || !user.lists || !user.lists[list]) {
			irc.say(input.context, "There is no such list.");
			break;
		}
		delete user.lists[list];
		pastaDB.saveOne(target, user);
		deleteList(user, list, type);
		irc.say(input.context, "Removed.");
		break;
	case "list":
		user = pastaDB.getOne(target);
		if (!user || !user.lists || !Object.keys(user.lists).length)
			irc.say(input.context, (cmd === "ulist" ? "You haven't created any lists." : input.context+" has no lists."));
		else
			irc.say(input.context, (cmd === "ulist" ? "Your lists: " : input.context+" lists: ")+
				lib.commaList(Object.keys(user.lists)));
		break;
	case "link":
		input.args[2] = "link";
	/* falls through */
	case "show": // pasta show listname
		if (input.args.length < 2) {
			irc.say(input.context, "[Help] Syntax: "+config.command_prefix+cmd+" show <list>");
			break;
		}
		user = pastaDB.getOne(target);
		if (!user || !user.lists) {
			irc.say(input.context, "You haven't made any lists. See "+config.command_prefix+cmd+" create");
			break;
		}
		if (!user.lists[list]) {
			irc.say(input.context, "There is no '"+list+"' list.");
			break;
		}
		if (!user.lists[list].length) {
			irc.say(input.context, (cmd === "ulist" ? "Your" : "The")+" '"+list+"' list is empty.");
			break;
		}
		if (input.args[2] && input.args[2] === "link")
			irc.say(input.context, constructPath(target, list, type));
		else
			irc.say(input.context, (cmd === "ulist" ? "Your" : "The")+" '"+list+"' list contains: "+
				lib.commaList(user.lists[list].map(function (listItem) { return listItem.name; })));
		break;
	case "template":
		if (input.args.length < 3) {
			irc.say(input.context, "[Help] Syntax: "+config.command_prefix+cmd+" template <list> <template>");
			break;
		}
		user = pastaDB.getOne(target);
		if (!user || !user.lists) {
			irc.say(input.context, "You haven't made any lists. See "+config.command_prefix+cmd+" create");
			break;
		}
		if (!user.lists[list]) {
			irc.say(input.context, "There is no '"+list+"' list.");
			break;
		}
		user.template = template;
		pastaDB.saveOne(target, user);
		irc.say(input.context, writeList(user, list, type, user.template));
		break;
	default:
		irc.say(input.context, bot.cmdHelp(cmd, "syntax"));
		break;
	}
}

bot.command({
	command: "clist",
	help: "Creates BOTDIR/data/www/#channel/listname.html with your channel list in it. "+
		"Not terribly useful if your bot doesn't run on a webserver, "+
		"or if you don't know how to point a www-root there. "+
		"The 'pasta path' option needs to be set in config.",
	syntax: config.command_prefix+"clist <create/delete/list/show/link/refresh/relink/add/remove> - create a list, then add to it. Example: "+
		config.command_prefix+"clist create anime - "+config.command_prefix+
		"clist add anime Steins;Gate google site:myanimelist.net/anime/ <- this will add Steins;Gate with a link to the first "+
		"google result for 'Steins;Gate site:myanimelist.net/anime/', or you can "+
		config.command_prefix+"clist add anime Steins;Gate http://myanimelist.net/anime/9253/Steins;Gate, "+
		" if the google result was wrong.",
	arglen: 1,
	callback: pastaCmd
});

bot.command({
	command: "ulist",
	help: "Creates BOTDIR/data/www/<yournick>/listname.html with your personal list in it. "+
		"Not terribly useful if your bot doesn't run on a webserver, "+
		"or if you don't know how to point a www-root to BOTDIR/data/www/. "+
		"The 'pasta path' option needs to be set in config.",
	syntax: config.command_prefix+"ulist <create/delete/list/show/link/refresh/relink/add/remove> - create a list, then add to it. Example: "+
		config.command_prefix+"ulist create anime - "+config.command_prefix+
		"ulist add anime Steins;Gate google site:myanimelist.net/anime/ <- this will add Steins;Gate with a link to the first "+
		"google result for 'Steins;Gate site:myanimelist.net/anime/', or you can "+
		config.command_prefix+"ulist add anime Steins;Gate http://myanimelist.net/anime/9253/Steins;Gate, "+
		" if the google result was wrong.",
	arglen: 1,
	callback: pastaCmd
});
