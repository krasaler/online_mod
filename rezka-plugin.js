(function () {
  'use strict';

  var Defined = {
    api: 'https://rezka.ag',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    proxy: 'https://cors.nb557.workers.dev/'
  };

  function useProxy() {
    return Lampa.Storage.get('rezka_use_proxy', false) === true;
  }

  function proxyUrl(url) {
    if (!useProxy()) return url;
    return Defined.proxy + url;
  }

  function getMirror() {
    var url = Lampa.Storage.get('rezka_mirror', '') + '';
    if (!url) return Defined.api;
    if (url.indexOf('://') === -1) url = 'https://' + url;
    if (url.charAt(url.length - 1) === '/') url = url.substring(0, url.length - 1);
    return url;
  }

  function getHeaders() {
    var host = getMirror();
    var cookie = Lampa.Storage.get('rezka_cookie', '') + '';
    var headers = {
      'Origin': host,
      'Referer': host + '/',
      'User-Agent': Defined.userAgent
    };
    if (cookie) {
      headers['Cookie'] = cookie;
    }
    return headers;
  }

  function decodeStreamUrl(encoded) {
    if (!encoded) return '';
    if (encoded.indexOf('#') === -1) return encoded;

    var trash = ['@', '#', '!', '^', '$'];
    var trashRegex = new RegExp('[' + trash.join('\\') + ']+', 'g');
    var cleaned = encoded.replace(trashRegex, '');

    try {
      return atob(cleaned);
    } catch (e) {
      return encoded;
    }
  }

  function parseStreams(data) {
    var streams = [];
    if (!data) return streams;

    var parts = data.split(',');
    parts.forEach(function (part) {
      var match = part.match(/\[(\d+p[^\]]*)\](https?:\/\/[^\s,]+)/);
      if (match) {
        var quality = match[1];
        var urlPart = match[2];
        var urls = urlPart.split(' or ');
        urls.forEach(function (url) {
          if (url) {
            streams.push({
              quality: quality,
              url: url.trim()
            });
          }
        });
      }
    });

    return streams;
  }

  function RezkaComponent(object) {
    var network = new Lampa.Reguest();
    var scroll = new Lampa.Scroll({ mask: true, over: true });
    var files = new Lampa.Explorer(object);
    var filter = new Lampa.Filter(object);

    var host = getMirror();
    var headers = getHeaders();
    var data_cache = {};
    var filter_items = {};
    var choice = {
      season: 0,
      voice: 0
    };
    var last;
    var items_list = [];

    this.create = function () {
      var _this = this;

      this.activity.loader(true);

      files.appendFiles(scroll);
      files.appendHead(filter);

      scroll.body().addClass('torrent-list');

      filter.onSelect = function (type, a, b) {
        _this.activity.loader(true);
        choice[type] = b;
        _this.reset();
        _this.loadContent();
      };

      filter.render().find('.filter--sort').remove();

      this.search();
    };

    this.search = function () {
      var _this = this;
      var title = object.search || object.movie.title;
      var search_url = host + '/engine/ajax/search.php';
      var search_year = parseInt((object.movie.release_date || object.movie.first_air_date || '0000').slice(0, 4));

      network.clear();
      network.timeout(15000);

      var postdata = 'q=' + encodeURIComponent(title);

      network.native(proxyUrl(search_url), function (str) {
        str = str || '';
        var links = str.match(/<li>\s*<a href=[\s\S]*?<\/li>/g);

        if (links && links.length) {
          var items = links.map(function (link) {
            var el = $(link);
            var a = $('a', el);
            var enty = $('.enty', a);
            var name = enty.text().trim();
            enty.remove();
            var info = a.text().trim();
            var href = a.attr('href') || '';
            var year = 0;
            var match = info.match(/\((\d{4})/);
            if (match) year = parseInt(match[1]);

            return {
              title: name,
              year: year,
              link: href
            };
          });

          var filtered = items.filter(function (item) {
            if (search_year && item.year) {
              return Math.abs(item.year - search_year) <= 1;
            }
            return true;
          });

          if (filtered.length === 1) {
            _this.getPage(filtered[0].link);
          } else if (filtered.length > 0) {
            _this.showResults(filtered);
          } else if (items.length > 0) {
            _this.showResults(items);
          } else {
            _this.empty(Lampa.Lang.translate('rezka_not_found') + ' (' + title + ')');
          }
        } else {
          _this.empty(Lampa.Lang.translate('rezka_not_found') + ' (' + title + ')');
        }
      }, function (a, c) {
        _this.empty(network.errorDecode(a, c));
      }, postdata, {
        dataType: 'text',
        headers: headers
      });
    };

    this.showResults = function (items) {
      var _this = this;
      scroll.clear();

      items.forEach(function (item) {
        var card = Lampa.Template.get('онлайн_folder', {
          title: item.title + (item.year ? ' (' + item.year + ')' : '')
        });

        card.on('hover:enter', function () {
          _this.activity.loader(true);
          _this.getPage(item.link);
        });

        scroll.append(card);
      });

      this.activity.loader(false);
      this.start();
    };

    this.getPage = function (url) {
      var _this = this;

      network.clear();
      network.timeout(15000);

      network.native(proxyUrl(url), function (str) {
        str = str || '';
        data_cache.page_url = url;

        if (str.indexOf('b-login__login_form') !== -1 && str.indexOf('b-content__main') === -1) {
          _this.empty(Lampa.Lang.translate('rezka_auth_required'));
          return;
        }

        var movie_id = '';
        var match = str.match(/data-id="(\d+)"/);
        if (match) movie_id = match[1];

        if (!movie_id) {
          _this.empty(Lampa.Lang.translate('rezka_no_data'));
          return;
        }

        data_cache.movie_id = movie_id;

        var is_series = str.indexOf('b-simple_seasons__list') !== -1 || str.indexOf('simple-episodes-list') !== -1;
        data_cache.is_series = is_series;

        var translators = [];
        var trans_match = str.match(/<ul id="translators-list"[^>]*>([\s\S]*?)<\/ul>/);
        if (trans_match) {
          var trans_items = trans_match[1].match(/<li[^>]*data-translator_id="(\d+)"[^>]*>([^<]+)<\/li>/g);
          if (trans_items) {
            trans_items.forEach(function (item) {
              var m = item.match(/data-translator_id="(\d+)"[^>]*>([^<]+)</);
              if (m) {
                translators.push({
                  id: m[1],
                  name: m[2].trim()
                });
              }
            });
          }
        }

        if (translators.length === 0) {
          var default_trans = str.match(/initCDNMoviesEvents\s*\(\s*(\d+)\s*,\s*(\d+)/);
          if (default_trans) {
            translators.push({
              id: default_trans[2],
              name: Lampa.Lang.translate('rezka_original')
            });
            data_cache.movie_id = default_trans[1];
          }
        }

        data_cache.translators = translators;

        if (is_series) {
          var seasons = [];
          var seasons_match = str.match(/<ul id="simple-seasons-tabs"[^>]*>([\s\S]*?)<\/ul>/);
          if (seasons_match) {
            var seasons_items = seasons_match[1].match(/<li[^>]*data-tab_id="(\d+)"[^>]*>([^<]+)<\/li>/g);
            if (seasons_items) {
              seasons_items.forEach(function (item) {
                var m = item.match(/data-tab_id="(\d+)"[^>]*>([^<]+)</);
                if (m) {
                  seasons.push({
                    id: m[1],
                    name: m[2].trim()
                  });
                }
              });
            }
          }
          data_cache.seasons = seasons;

          var episodes_data = {};
          var episodes_blocks = str.match(/<ul id="simple-episodes-list-(\d+)"[^>]*>([\s\S]*?)<\/ul>/g);
          if (episodes_blocks) {
            episodes_blocks.forEach(function (block) {
              var season_match = block.match(/id="simple-episodes-list-(\d+)"/);
              if (season_match) {
                var season_id = season_match[1];
                var eps = [];
                var ep_items = block.match(/<li[^>]*data-episode_id="(\d+)"[^>]*>([^<]+)<\/li>/g);
                if (ep_items) {
                  ep_items.forEach(function (item) {
                    var m = item.match(/data-episode_id="(\d+)"[^>]*>([^<]+)</);
                    if (m) {
                      eps.push({
                        id: m[1],
                        name: m[2].trim()
                      });
                    }
                  });
                }
                episodes_data[season_id] = eps;
              }
            });
          }
          data_cache.episodes = episodes_data;
        }

        _this.buildFilter();
        _this.loadContent();

      }, function (a, c) {
        _this.empty(network.errorDecode(a, c));
      }, false, {
        dataType: 'text',
        headers: headers
      });
    };

    this.buildFilter = function () {
      filter_items = {};

      if (data_cache.translators && data_cache.translators.length > 1) {
        filter_items.voice = data_cache.translators.map(function (t) {
          return t.name;
        });
      }

      if (data_cache.is_series && data_cache.seasons && data_cache.seasons.length > 0) {
        filter_items.season = data_cache.seasons.map(function (s) {
          return s.name;
        });
      }

      filter.set('voice', filter_items.voice || []);
      filter.set('season', filter_items.season || []);

      filter.chosen('voice', [choice.voice]);
      filter.chosen('season', [choice.season]);
    };

    this.loadContent = function () {
      var _this = this;
      var movie_id = data_cache.movie_id;
      var translator_id = '';

      if (data_cache.translators && data_cache.translators.length > 0) {
        translator_id = data_cache.translators[choice.voice] ? data_cache.translators[choice.voice].id : data_cache.translators[0].id;
      }

      scroll.clear();
      items_list = [];

      if (data_cache.is_series) {
        var season_data = data_cache.seasons && data_cache.seasons[choice.season] ? data_cache.seasons[choice.season] : data_cache.seasons && data_cache.seasons[0];
        var season_id = season_data ? season_data.id : '1';
        var episodes = data_cache.episodes && data_cache.episodes[season_id] ? data_cache.episodes[season_id] : [];

        if (episodes.length === 0) {
          _this.empty(Lampa.Lang.translate('rezka_no_episodes'));
          return;
        }

        episodes.forEach(function (ep, index) {
          var item = {
            title: ep.name,
            season: parseInt(season_id),
            episode: index + 1,
            episode_id: ep.id,
            translator_id: translator_id,
            movie_id: movie_id
          };

          items_list.push(item);
          _this.appendItem(item);
        });

      } else {
        var item = {
          title: object.movie.title || Lampa.Lang.translate('rezka_movie'),
          movie_id: movie_id,
          translator_id: translator_id
        };

        items_list.push(item);
        _this.appendItem(item);
      }

      this.activity.loader(false);
      this.start();
    };

    this.appendItem = function (item) {
      var _this = this;
      var hash = Lampa.Utils.hash(object.movie.id + '_' + (item.season || 0) + '_' + (item.episode || 0));
      var viewed = Lampa.Timeline.view(hash);

      var card = Lampa.Template.get('онлайн_prestige_full', {
        title: item.title,
        info: ''
      });

      card.addClass('video--stream');

      if (viewed.percent) {
        card.find('.torrent-item__progress-bar').css('width', viewed.percent + '%');
      }

      card.on('hover:enter', function () {
        _this.getStream(item, function (stream) {
          if (stream && stream.file) {
            var playlist = [{
              title: item.title,
              url: stream.file,
              quality: stream.quality
            }];

            if (items_list.length > 1 && item.episode) {
              playlist = items_list.map(function (el) {
                return {
                  title: el.title,
                  url: function (callback) {
                    _this.getStream(el, function (s) {
                      callback(s && s.file ? s.file : '');
                    });
                  },
                  quality: stream.quality
                };
              });
            }

            var play_item = playlist.find(function (el) { return el.title === item.title; }) || playlist[0];

            Lampa.Player.play(play_item);
            Lampa.Player.playlist(playlist);

            if (item.episode) {
              Lampa.Timeline.update({
                hash: hash,
                season: item.season,
                episode: item.episode,
                title: object.movie.title,
                poster: object.movie.poster_path
              });
            }
          } else {
            Lampa.Noty.show(Lampa.Lang.translate('rezka_stream_error'));
          }
        });
      });

      scroll.append(card);
    };

    this.getStream = function (element, callback) {
      var movie_id = element.movie_id || data_cache.movie_id;
      var translator_id = element.translator_id || '';

      var action = data_cache.is_series ? 'get_stream' : 'get_movie';

      var params = {
        id: movie_id,
        translator_id: translator_id,
        action: action
      };

      if (data_cache.is_series) {
        params.season = element.season || 1;
        params.episode = element.episode_id || 1;
      }

      var url = host + '/ajax/get_cdn_series/?t=' + Date.now();
      var postdata = Object.keys(params).map(function (key) {
        return key + '=' + encodeURIComponent(params[key]);
      }).join('&');

      network.clear();
      network.timeout(15000);

      network.native(proxyUrl(url), function (json) {
        if (json && json.url) {
          var decoded = decodeStreamUrl(json.url);
          var streams = parseStreams(decoded);

          if (streams.length > 0) {
            var files = streams.map(function (s) {
              return {
                title: s.quality,
                quality: s.quality,
                file: s.url
              };
            });

            var best = files[files.length - 1];

            callback({
              file: best.file,
              quality: files.reduce(function (acc, f) {
                acc[f.quality] = f.file;
                return acc;
              }, {})
            });
          } else {
            callback(null);
          }
        } else {
          callback(null);
        }
      }, function () {
        callback(null);
      }, postdata, {
        headers: headers
      });
    };

    this.reset = function () {
      network.clear();
    };

    this.empty = function (msg) {
      scroll.clear();
      var empty = Lampa.Template.get('list_empty');
      if (msg) empty.find('.empty__descr').text(msg);
      scroll.append(empty);
      this.activity.loader(false);
      this.start();
    };

    this.start = function () {
      if (Lampa.Activity.active().activity !== this.activity) return;

      Lampa.Controller.add('content', {
        toggle: function () {
          Lampa.Controller.collectionSet(scroll.render(), files.render());
          Lampa.Controller.collectionFocus(last || false, scroll.render());
        },
        left: function () {
          if (Navigator.canmove('left')) Navigator.move('left');
          else Lampa.Controller.toggle('menu');
        },
        right: function () {
          if (Navigator.canmove('right')) Navigator.move('right');
          else filter.show(Lampa.Lang.translate('title_filter'), 'filter');
        },
        up: function () {
          if (Navigator.canmove('up')) Navigator.move('up');
          else Lampa.Controller.toggle('head');
        },
        down: function () {
          Navigator.move('down');
        },
        back: this.back
      });

      Lampa.Controller.toggle('content');
    };

    this.pause = function () {};
    this.stop = function () {};
    this.render = function () { return files.render(); };
    this.back = function () { Lampa.Activity.backward(); };

    this.destroy = function () {
      network.clear();
      files.destroy();
      scroll.destroy();
    };
  }

  function doLogin(callback) {
    var host = getMirror();
    var login = Lampa.Storage.get('rezka_login', '');
    var password = Lampa.Storage.get('rezka_password', '');

    if (!login || !password) {
      Lampa.Noty.show(Lampa.Lang.translate('rezka_enter_credentials'));
      return;
    }

    var network = new Lampa.Reguest();
    var url = host + '/ajax/login/';

    var postdata = 'login_name=' + encodeURIComponent(login) + '&login_password=' + encodeURIComponent(password) + '&login_not_498=1';

    network.native(proxyUrl(url), function (json) {
      if (json && json.success) {
        Lampa.Noty.show(Lampa.Lang.translate('rezka_login_success'));
        if (callback) callback(true);
      } else {
        Lampa.Noty.show(json && json.message ? json.message : Lampa.Lang.translate('rezka_login_failed'));
        if (callback) callback(false);
      }
    }, function () {
      Lampa.Noty.show(Lampa.Lang.translate('rezka_login_failed'));
      if (callback) callback(false);
    }, postdata, {
      headers: getHeaders()
    });
  }

  function addSettings() {
    if (Lampa.Settings.main && Lampa.Settings.main().render) {
      var field = $('<div class="settings-folder selector" data-component="rezka_settings">' +
        '<div class="settings-folder__icon">' +
        '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
        '<path d="M4 8L12 4L20 8V16L12 20L4 16V8Z" stroke="currentColor" stroke-width="2"/>' +
        '<path d="M12 12L12 20M12 12L4 8M12 12L20 8" stroke="currentColor" stroke-width="2"/>' +
        '</svg>' +
        '</div>' +
        '<div class="settings-folder__name">HDRezka</div>' +
        '</div>');

      Lampa.Settings.main().render().find('[data-component="more"]').after(field);
    }

    Lampa.Settings.listener.follow('open', function (event) {
      if (event.name === 'main') {
        var field = event.body.find('[data-component="rezka_settings"]');
        field.unbind('hover:enter').on('hover:enter', function () {
          Lampa.Settings.create('rezka_settings');
        });
      }

      if (event.name === 'rezka_settings') {
        event.body.find('.settings-param').remove();

        var html = '<div class="settings-param selector" data-name="rezka_mirror" data-type="input">' +
          '<div class="settings-param__name">' + Lampa.Lang.translate('rezka_mirror') + '</div>' +
          '<div class="settings-param__value">' + (Lampa.Storage.get('rezka_mirror', '') || Defined.api) + '</div>' +
          '</div>';

        html += '<div class="settings-param selector" data-name="rezka_login" data-type="input">' +
          '<div class="settings-param__name">' + Lampa.Lang.translate('rezka_login') + '</div>' +
          '<div class="settings-param__value">' + (Lampa.Storage.get('rezka_login', '') || '-') + '</div>' +
          '</div>';

        html += '<div class="settings-param selector" data-name="rezka_password" data-type="input">' +
          '<div class="settings-param__name">' + Lampa.Lang.translate('rezka_password') + '</div>' +
          '<div class="settings-param__value">' + (Lampa.Storage.get('rezka_password', '') ? '******' : '-') + '</div>' +
          '</div>';

        html += '<div class="settings-param selector" data-name="rezka_do_login">' +
          '<div class="settings-param__name">' + Lampa.Lang.translate('rezka_do_login') + '</div>' +
          '</div>';

        html += '<div class="settings-param selector" data-name="rezka_clear_cookie">' +
          '<div class="settings-param__name">' + Lampa.Lang.translate('rezka_clear_cookie') + '</div>' +
          '</div>';

        html += '<div class="settings-param selector" data-name="rezka_use_proxy" data-type="toggle">' +
          '<div class="settings-param__name">' + Lampa.Lang.translate('rezka_use_proxy') + '</div>' +
          '<div class="settings-param__value">' + (Lampa.Storage.get('rezka_use_proxy', false) ? Lampa.Lang.translate('settings_param_yes') : Lampa.Lang.translate('settings_param_no')) + '</div>' +
          '</div>';

        event.body.append(html);

        event.body.find('[data-name="rezka_mirror"]').unbind('hover:enter').on('hover:enter', function () {
          Lampa.Input.edit({
            title: Lampa.Lang.translate('rezka_mirror'),
            value: Lampa.Storage.get('rezka_mirror', ''),
            free: true
          }, function (value) {
            Lampa.Storage.set('rezka_mirror', value);
            event.body.find('[data-name="rezka_mirror"] .settings-param__value').text(value || Defined.api);
          });
        });

        event.body.find('[data-name="rezka_login"]').unbind('hover:enter').on('hover:enter', function () {
          Lampa.Input.edit({
            title: Lampa.Lang.translate('rezka_login'),
            value: Lampa.Storage.get('rezka_login', ''),
            free: true
          }, function (value) {
            Lampa.Storage.set('rezka_login', value);
            event.body.find('[data-name="rezka_login"] .settings-param__value').text(value || '-');
          });
        });

        event.body.find('[data-name="rezka_password"]').unbind('hover:enter').on('hover:enter', function () {
          Lampa.Input.edit({
            title: Lampa.Lang.translate('rezka_password'),
            value: Lampa.Storage.get('rezka_password', ''),
            free: true
          }, function (value) {
            Lampa.Storage.set('rezka_password', value);
            event.body.find('[data-name="rezka_password"] .settings-param__value').text(value ? '******' : '-');
          });
        });

        event.body.find('[data-name="rezka_do_login"]').unbind('hover:enter').on('hover:enter', function () {
          doLogin();
        });

        event.body.find('[data-name="rezka_clear_cookie"]').unbind('hover:enter').on('hover:enter', function () {
          Lampa.Storage.set('rezka_cookie', '');
          Lampa.Noty.show(Lampa.Lang.translate('rezka_cookie_cleared'));
        });

        event.body.find('[data-name="rezka_use_proxy"]').unbind('hover:enter').on('hover:enter', function () {
          var current = Lampa.Storage.get('rezka_use_proxy', false);
          Lampa.Storage.set('rezka_use_proxy', !current);
          event.body.find('[data-name="rezka_use_proxy"] .settings-param__value').text(!current ? Lampa.Lang.translate('settings_param_yes') : Lampa.Lang.translate('settings_param_no'));
        });
      }
    });
  }

  function addButton(render, object) {
    var btn = $('<div class="full-start__button selector view--rezka">' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">' +
      '<path d="M8 5v14l11-7z"/>' +
      '</svg>' +
      '<span>Rezka</span>' +
      '</div>');

    btn.on('hover:enter', function () {
      Lampa.Activity.push({
        url: '',
        title: Lampa.Lang.translate('rezka_watch'),
        component: 'rezka_online',
        search: object.title,
        search_one: object.title,
        search_two: object.original_title,
        movie: object,
        page: 1
      });
    });

    var place = render.find('.view--torrent, .view--trailer, .view--online_mod').last();
    if (place.length) {
      place.after(btn);
    } else {
      render.find('.full-start__buttons').append(btn);
    }
  }

  function addLang() {
    Lampa.Lang.add({
      rezka_settings_title: {
        ru: 'HDRezka',
        uk: 'HDRezka',
        en: 'HDRezka',
        zh: 'HDRezka'
      },
      rezka_mirror: {
        ru: 'Зеркало сайта',
        uk: 'Дзеркало сайту',
        en: 'Site mirror',
        zh: '网站镜像'
      },
      rezka_login: {
        ru: 'Логин или email',
        uk: 'Логін або email',
        en: 'Login or email',
        zh: '登录名或电子邮件'
      },
      rezka_password: {
        ru: 'Пароль',
        uk: 'Пароль',
        en: 'Password',
        zh: '密码'
      },
      rezka_do_login: {
        ru: 'Войти в аккаунт',
        uk: 'Увійти в акаунт',
        en: 'Log in',
        zh: '登录'
      },
      rezka_clear_cookie: {
        ru: 'Очистить куки (выйти)',
        uk: 'Очистити кукі (вийти)',
        en: 'Clear cookies (logout)',
        zh: '清除 Cookie（注销）'
      },
      rezka_watch: {
        ru: 'Смотреть на Rezka',
        uk: 'Дивитися на Rezka',
        en: 'Watch on Rezka',
        zh: '在 Rezka 上观看'
      },
      rezka_auth_required: {
        ru: 'Требуется авторизация на HDRezka',
        uk: 'Потрібна авторизація на HDRezka',
        en: 'Authorization required on HDRezka',
        zh: '需要在 HDRezka 上授权'
      },
      rezka_no_data: {
        ru: 'Не удалось получить данные',
        uk: 'Не вдалося отримати дані',
        en: 'Failed to get data',
        zh: '获取数据失败'
      },
      rezka_enter_credentials: {
        ru: 'Введите логин и пароль в настройках',
        uk: 'Введіть логін та пароль у налаштуваннях',
        en: 'Enter login and password in settings',
        zh: '在设置中输入用户名和密码'
      },
      rezka_login_success: {
        ru: 'Вход выполнен успешно',
        uk: 'Вхід виконано успішно',
        en: 'Login successful',
        zh: '登录成功'
      },
      rezka_login_failed: {
        ru: 'Ошибка входа',
        uk: 'Помилка входу',
        en: 'Login failed',
        zh: '登录失败'
      },
      rezka_cookie_cleared: {
        ru: 'Куки очищены',
        uk: 'Кукі очищено',
        en: 'Cookies cleared',
        zh: 'Cookie 已清除'
      },
      rezka_not_found: {
        ru: 'Ничего не найдено',
        uk: 'Нічого не знайдено',
        en: 'Nothing found',
        zh: '未找到任何内容'
      },
      rezka_original: {
        ru: 'Оригинал',
        uk: 'Оригінал',
        en: 'Original',
        zh: '原版'
      },
      rezka_movie: {
        ru: 'Фильм',
        uk: 'Фільм',
        en: 'Movie',
        zh: '电影'
      },
      rezka_no_episodes: {
        ru: 'Эпизоды не найдены',
        uk: 'Епізоди не знайдено',
        en: 'No episodes found',
        zh: '未找到剧集'
      },
      rezka_stream_error: {
        ru: 'Не удалось получить видеопоток',
        uk: 'Не вдалося отримати відеопотік',
        en: 'Failed to get video stream',
        zh: '无法获取视频流'
      },
      rezka_use_proxy: {
        ru: 'Использовать прокси',
        uk: 'Використовувати проксі',
        en: 'Use proxy',
        zh: '使用代理'
      }
    });
  }

  function addTemplates() {
    Lampa.Template.add('онлайн_folder', '<div class="selector folder"><div class="folder__icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg></div><div class="folder__name">{title}</div></div>');

    Lampa.Template.add('онлайн_prestige_full', '<div class="selector torrent-item video--stream"><div class="torrent-item__title">{title}</div><div class="torrent-item__details"><div class="torrent-item__info">{info}</div></div><div class="torrent-item__progress"><div class="torrent-item__progress-bar"></div></div></div>');
  }

  function startPlugin() {
    if (window.rezka_plugin_loaded) return;
    window.rezka_plugin_loaded = true;

    addLang();
    addTemplates();

    Lampa.Component.add('rezka_online', RezkaComponent);

    Lampa.Listener.follow('full', function (event) {
      if (event.type === 'complite') {
        var render = event.object.activity.render();
        var movie = event.data.movie || event.data;

        setTimeout(function () {
          addButton(render, movie);
        }, 100);
      }
    });

    setTimeout(function () {
      addSettings();
    }, 500);
  }

  if (window.appready) {
    startPlugin();
  } else {
    Lampa.Listener.follow('app', function (event) {
      if (event.type === 'ready') {
        startPlugin();
      }
    });
  }

})();
