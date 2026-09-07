var dataArrays; // 使用者設定 json
var proxy_protocol;
var proxy_ip;
var proxy_port;
var proxy_user = '';
var proxy_passwd = '';
id_list.push('proxy_protocol', 'proxy_ip', 'proxy_port', 'proxy_user', 'proxy_passwd');

$.ajax({
	type: "get",
	url: "data/config.json",
	dataType: "json",
	async: true,
	success: function(data) {
		dataArrays = data;
		parseProxy(data.proxy);
		$(function (){
			renderJson();
		});
	}
});

function parseProxy(proxy) {
	// 逐段拆解, 任何一段缺失都只讓該欄位留空, 不可拋例外, 否則整個設定頁會渲染不出來
	proxy = (proxy || '').trim();
	proxy_protocol = 'HTTP';
	proxy_ip = '';
	proxy_port = '';
	proxy_user = '';
	proxy_passwd = '';

	var rest = proxy;
	var schemeMatch = /^([a-z0-9+.\-]+):\/\/([\s\S]*)$/i.exec(rest);
	if (schemeMatch) {
		proxy_protocol = schemeMatch[1].toUpperCase();
		rest = schemeMatch[2];
	}

	var at = rest.lastIndexOf('@');
	if (at !== -1) {
		var cred = rest.slice(0, at);
		rest = rest.slice(at + 1);
		var sep = cred.indexOf(':');
		if (sep === -1) {
			proxy_user = cred;
		} else {
			proxy_user = cred.slice(0, sep);
			proxy_passwd = cred.slice(sep + 1);
		}
	}

	var portMatch = /:(\d+)$/.exec(rest);
	if (portMatch) {
		proxy_port = portMatch[1];
		proxy_ip = rest.slice(0, rest.length - portMatch[0].length);
	} else {
		proxy_ip = rest;
	}

	dataArrays.proxy_protocol = proxy_protocol;
	dataArrays.proxy_ip = proxy_ip;
	dataArrays.proxy_port = proxy_port;
	dataArrays.proxy_user = proxy_user;
	dataArrays.proxy_passwd = proxy_passwd;
}

function buildProxyString() {
	var protocol = String(dataArrays['proxy_protocol'] || 'http').toLowerCase();
	var ip = String(dataArrays['proxy_ip'] || '').trim();
	var port = String(dataArrays['proxy_port'] || '').trim();
	var user = String(dataArrays['proxy_user'] || '');
	var passwd = String(dataArrays['proxy_passwd'] || '');

	if (!ip) {
		return ''; // 沒填位址就視為未設定代理
	}
	var host = port ? ip + ':' + port : ip;
	if (user.length === 0 || passwd.length === 0) {
		return protocol + '://' + host; // 帳號或密碼任一為空即不帶認證資訊
	}
	return protocol + '://' + user + ':' + passwd + '@' + host;
}

function setSelectValue(id, value) {
	// 依 value / 顯示文字精確比對, 避免 :contains 用子字串誤選到別的選項
	var $select = $('#' + id);
	var target = String(value == null ? '' : value).trim();
	var candidates = [target, target + 'P'];
	var matched = null;
	$select.find('option').each(function () {
		var $option = $(this);
		var optionValue = $option.attr('value');
		var text = $option.text().trim();
		if (matched === null && (candidates.indexOf(text) !== -1
			|| (optionValue !== undefined && candidates.indexOf(String(optionValue)) !== -1))) {
			matched = $option;
		}
		$option.prop('selected', false);
	});
	if (matched !== null) {
		matched.prop('selected', true);
	}
	$select.selectpicker('render');
}

function reloadSetting() {
	readJson();
	renderJson();
}

function readJson() {
	$.getJSON("data/config.json", function(data) {
		dataArrays = data;
		parseProxy(data.proxy); // 解析代理配置
	});
}

function syncSettingControlWidths() {
	var $sw = $('#page-settings .my-button.col-md-4 .bootstrap-switch').first();
	if (!$sw.length) {
		$sw = $('#manualTasks .setting-control-row .bootstrap-switch').first();
	}
	if (!$sw.length) {
		return;
	}
	var w = Math.round($sw.outerWidth());
	if (w > 0) {
		document.documentElement.style.setProperty('--setting-control-width', w + 'px');
		var $controls = $('#page-settings .my-button.col-md-4 > .bootstrap-select.form-control, #manualTasks .setting-control-row > .bootstrap-select.form-control');
		$controls.each(function() {
			$(this).css({ width: w, maxWidth: w, minWidth: w });
		});
	}
}
window.syncSettingControlWidths = syncSettingControlWidths;

function renderJson() {
	for (var id of id_list) {
		if (id == 'proxy') continue; //代理設定已被分解
		var idType = document.getElementById(id).type;
		switch (idType) {
			case 'text':
			case 'number':
			case 'password':
				if (id  == 'multi-thread')  // 手動任務的預設執行緒數
					$('#manual_thread_limit').val(dataArrays[id]);
				$("#" + id).val(dataArrays[id]);
				break;
			case 'checkbox':
				$("#" + id).bootstrapSwitch('state', dataArrays[id]);
				break;
			case 'select-one':
				if (id == 'proxy_protocol') {
					$("#" + id).selectpicker('val', String(dataArrays[id] || 'HTTP').toUpperCase());
				} else {
					setSelectValue(id, dataArrays[id]);
				}
				break;

		}
	}
	syncSettingControlWidths();
}


function readSettings() {
	for (var id of id_list) {
		if (id == 'proxy') continue; //代理設定已被分解

		var idType = document.getElementById(id).type;
		switch (idType) {
			case 'number':
				dataArrays[id] = Number($("#" + id).val());
				break;
			case 'text':
			case 'password':
				dataArrays[id] = $("#" + id).val();
				break;
			case 'checkbox':
				dataArrays[id] = $("#" + id).is(":checked");
				break;
			case 'select-one':
				if (id == 'proxy_protocol') {
					dataArrays[id] = $("#proxy_protocol").val().toLowerCase();
				} else if (id == 'download_resolution') {
					dataArrays[id] = $("#download_resolution").val().replace('P', '');
				} else {
					dataArrays[id] = $("#" + id).val();
				}
				break;
		}
	}

	// 讀完所有欄位後再合併一次代理配置
	dataArrays["proxy"] = buildProxyString();

	$.ajax({
		url: '/uploadConfig',
		type: 'post',
		dataType: 'json',
		headers: {
			"Content-Type": "application/json;charset=utf-8"
		},
		contentType: 'application/json; charset=utf-8',
		data: JSON.stringify(dataArrays),
		success: function(data) {
			showUploadSuccess();
			reloadSetting();
		},
		error:function(status){
			showUploadFailure();
		}
	})
}

function getUA(){
	$('#ua').val(navigator.userAgent);
	alert("已取得當前瀏覽器UA");
}