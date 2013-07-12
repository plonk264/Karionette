var url = require('url');

listen({
	plugin: "geoip",
	handle: "geoip",
	regex: regexFactory.startsWith("geoip"),
	command: {
		root: "geoip",
		help: "Stalks motherflippers - Syntax: " + config.command_prefix + "geoip <nick/hostname/IP/url>",
		syntax: "[Help] Syntax: " + config.command_prefix + "geoip <nick/hostname/IP/url>"
	},
	callback: function (input, match) {
		var args = match[1].split(" "),
			target, resp = [], nick;
		if (args && args[0].length > 0) {
			if (args[0].indexOf('.') > -1) {
				if (args[0].match(/https?:\/\/[^ ]+/)) target = url.parse(args[0]).host;
				else target = args[0];
			} else {
				target = ial.User(args[0], input.context);
				if (target.address) {
					nick = target.nick;
					target = target.address.split("@")[1];
				} else {
					irc.say(input.context, "I don't see a "+args[0]+" in here.");
					irc.say(input.context, this.command.syntax);
					return;
				}
			}
			web.get("http://freegeoip.net/json/"+target, function (error, response, body) {
				if (error) {
					logger.error("[GeoIP] Error - "+error);
					irc.say(input.context, "Something has gone awry.");
					return;
				}
				body = JSON.parse(body);
				if (body) {
					if (body.country_name) resp.push(body.country_name);
					if (body.city) resp.push(body.city);
				}
				if (resp.length > 0) {
					irc.say(input.context, (nick ? nick: target) + " is in "+resp.join(", "));
				} else {
					irc.say(input.context, "Ninja detected.");
				}
			});
		} else {
			irc.say(input.context, this.command.syntax);
		}
	}
});