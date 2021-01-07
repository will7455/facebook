const _ = require('lodash');
const debug = require('debug')('routes:public');
const nconf = require('nconf');
const moment = require('moment');

const mongo3 = require('../lib/mongo3');

function buildFilter(weekn) {
    const startISO = moment("2020-12-28").add(weekn, 'week');
    const endISO = moment("2020-12-28").add(weekn + 1, 'week');

    return filter = {
        "nature.kind": 'ad',
        impressionTime: { "$gte": new Date(startISO), "$lte": new Date(endISO)}
    };
}

async function getData(filter) {
    const mongodriver = await mongo3.clientConnect({concurrency: 1});
    /* publisher, text, link-to-image, paadcID, 
        savingTime, timelineId, impressionOrder, semanticID) */
    const content = await mongo3.readLimit(mongodriver, nconf.get('schema').metadata,
        filter, { impressionTime: -1 }, 5000, 0
    );
    debug("Returning from DB advertising %d elements (filtered as %j",
        _.size(content), filter);
    await mongodriver.close();
    return content;
}

function testHack(userId) {
    let retval = "";
    const convstr = (userId % 0xffff);
    _.times(_.size(convstr.toString()), function(i) {
        retval += convstr.toString().charCodeAt(i);
    });
    return retval.substr(0, 9);
}

async function ad(req) {
    const weekn = _.parseInt(req.params.weekn);
    const currentAsW = _.parseInt(
        _.round( moment.duration (  moment() - moment("2020-12-28") ) .asWeeks(), 1)
         .toString());

    if(_.isNaN(weekn)) {
        return {
            text: "This URL need a parameter specifing the week number — Current week need: /api/v2/ad/" + currentAsW
        }
    }
    if(currentAsW >= 52) {
        return {
            text: "This tool is supposed to be used only in 2021"
        }
    }

    const currentNextW = currentAsW + 1;
    debug("accessing to look for ad weekn %d (current %d, next %d)",
        weekn, currentAsW, currentNextW);


    const filter = buildFilter(weekn);
    const content = await getData(filter);
    const redacted = _.compact(_.map(content, function(e) {

        if(e.paadc == null || e.paadc == "undefined") {
            // return null; when the TEST-PATCH is gone
            e.paadc = testHack(e.userId);
        }

        const r = _.omit(e,
            ['savingTime', 'meaningfulId', 'hrefs', 
            'images', 'pseudo', 'userId', 'when', 'nature', '_id' ]);

        r.images = _.filter(e.images, function(img) {
            if(img.linktype !== 'cdn')
                return false;
            if(_.startsWith(img.src, "https://static.xx.fbcdn.net"))
                return false;
            if(img.height == "16" && img.width == "16")
                return false;
            return true;
        });
        r.images = _.map(r.images, 'src');

        try {
            const p = _.filter(e.meaningfulId.local, {fblinktype: 'profile'});
            if(_.size(p))
                r.profiles = [];
            _.each(p, function(problock) {
                let proflink = 'https://www.facebook.com/' + problock.profileName;
                if(r.profiles.indexOf(proflink) == -1)
                    r.profiles.push(proflink);
            });
        } catch(error) {}

        try {
            const ext = _filter(e.hrefs, {linktype: 'external'});
            if(_.size(ext))
                r.links = [];
            _.each(ext, function(exblock) {
                let elink = decodeURIComponent(
                    new URL(exblock.href).search
                ).replace(/\?u=/, '').replace(/\?.*/,'')
                if(r.links.indexOf(elink) == -1)
                    r.links.push(elink);
            })
        } catch(error) {}

        return r;
    }));
    return { json: redacted };
};

async function advstats(req) {

    debug("Start for internal usage");
    // const weekn = _.parseInt(req.params.weekn);
    // const filter = buildFilter(weekn);
    const filter = { "nature.kind": 'ad' };
    const content = await getData(filter);
    const valid = _.compact(_.map(content, function(e) {

        if(e.paadc == null || e.paadc == "undefined") {
            return null; 
        }
        return e;
    }));
    
    const stats = _.countBy(valid, 'publisherName');
    return { json: {
        counted: stats,
        returned: _.size(content),
        valid: _.size(valid)
    } };
}

module.exports = {
    ad,
    advstats,
};
