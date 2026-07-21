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
	proxy_protocol = proxy.replace(/:\/\/.*/i, '').toUpperCase();
	if (/.*@.*/.test(proxy)) {
		proxy_user = /:\/\/.*?:/g.exec(proxy)[0].replace(/:(\/\/)?/g, '');
		proxy_passwd = /:.*@/.exec(proxy)[0].replace(proxy_user, '')
			.replace(/(:\/\/:)?@?/g, '');
		proxy = proxy.replace(proxy_user + ':' + proxy_passwd + '@', '');
	}
	var tmp = proxy.replace(/.*:\/\//i, '');
	if (proxy.length > 0) {
		proxy_ip = /:.*:/.exec(proxy)[0].replace(/:(\/\/)?/g, '');
		proxy_port = /:\d+/.exec(proxy)[0].replace(/:/, '');
	} else {
		proxy_ip = '';
		proxy_port = '';
	}
	
	dataArrays.proxy_protocol = proxy_protocol;
	dataArrays.proxy_ip = proxy_ip;
	dataArrays.proxy_port = proxy_port;
	dataArrays.proxy_user = proxy_user;
	dataArrays.proxy_passwd = proxy_passwd;
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
					$("#" + id).selectpicker('val', dataArrays[id].toUpperCase());
				} else {
					$("#" + id).find("option:contains('" + dataArrays[id] + "')")
						.prop("selected", true);
					$("#" + id).selectpicker('render');
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

		// 合併代理配置
		var a = ['proxy_protocol', 'proxy_ip', 'proxy_port', 'proxy_user', 'proxy_passwd'];
		for (var i in a) {
			var ip_port = dataArrays["proxy_ip"] + ':' + dataArrays["proxy_port"];
			var protocol = dataArrays["proxy_protocol"] + '://';
			if (dataArrays["proxy_user"]?.length * dataArrays["proxy_passwd"]?.length == 0) {
				// 如果沒有使用者密碼
				dataArrays["proxy"] = protocol + ip_port;
			} else {
				// 如果有使用者密碼
				var user_pw = dataArrays["proxy_user"] + ':' + dataArrays["proxy_passwd"] + '@';
				dataArrays["proxy"] = protocol + user_pw + ip_port;
			}

		}
	}

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