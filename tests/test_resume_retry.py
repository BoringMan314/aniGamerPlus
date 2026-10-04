"""Offline regressions; load definitions without starting the application's workers."""
import ast
import copy
import os
from pathlib import Path
from queue import Queue
import re
import tempfile
import threading
import unittest
from unittest.mock import Mock, MagicMock
from types import SimpleNamespace
from bs4 import BeautifulSoup


ROOT = Path(__file__).resolve().parents[1]


def definitions(filename, names, namespace):
    tree = ast.parse((ROOT / filename).read_text(encoding='utf-8-sig'))
    tree.body = [node for node in tree.body
                 if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name in names]
    exec(compile(tree, filename, 'exec'), namespace)
    return namespace


class ResumeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.config = Mock()
        self.config.legalize_filename.side_effect = lambda name: name
        ns = definitions('Anime.py', {'Anime'}, {'os': os, 're': re, 'Config': self.config,
                                               'err_print': Mock()})
        self.anime = ns['Anime'].__new__(ns['Anime'])
        self.anime._settings = dict(download_resolution='1080', bangumi_dir=self.temp.name,
                                    zerofill=2, plex_naming=False,
                                    add_bangumi_name_to_video_filename=True,
                                    customized_video_filename_prefix='', customized_bangumi_name_suffix='',
                                    add_resolution_to_video_filename=True,
                                    customized_video_filename_suffix='', video_filename_extension='mp4')
        self.anime._title = 'Example [1]'
        self.anime._bangumi_name = 'Example'
        self.anime._episode = '1'
        self.anime._sn = 10
        self.anime.video_resolution = 0
        self.anime._Anime__get_m3u8_dict = Mock(side_effect=RuntimeError('network reached'))

    def file(self, name, size=6 * 1024 * 1024):
        path = Path(self.temp.name) / 'nested' / name
        path.parent.mkdir(exist_ok=True)
        with path.open('wb') as stream:
            stream.truncate(size)
        return path

    def test_fallback_resolution_in_subdirectory_is_preserved(self):
        path = self.file('Example[01][720P].mp4')
        self.anime.download(resume=True)
        self.assertEqual(self.anime.local_video_path, str(path))
        self.anime._Anime__get_m3u8_dict.assert_not_called()

    def test_renamed_series_is_preserved(self):
        self.file('Renamed[01][1080P].mp4')
        self.anime.download(rename='Renamed', resume=True)
        self.assertTrue(self.anime._resume_skipped)

    def test_custom_save_directory(self):
        self.file('Example[01][1080P].mp4')
        self.anime._settings['bangumi_dir'] = 'missing-directory'
        self.anime.download(save_dir=self.temp.name, resume=True)
        self.assertTrue(self.anime._resume_skipped)

    def test_incomplete_and_other_episode_do_not_skip(self):
        self.file('Example[01][1080P].mp4', 5 * 1024 * 1024)
        self.file('Example[02][1080P].mp4')
        self.file('Example[01][1080P].DOWNLOADING.mp4')
        # Supply the exception type referenced by the production handler.
        self.anime.download.__globals__['TryTooManyTimeError'] = type('RetryError', (Exception,), {})
        with self.assertRaisesRegex(RuntimeError, 'network reached'):
            self.anime.download(resume=True)

    def test_non_resume_still_downloads(self):
        self.file('Example[01][1080P].mp4')
        self.anime.download.__globals__['TryTooManyTimeError'] = type('RetryError', (Exception,), {})
        with self.assertRaisesRegex(RuntimeError, 'network reached'):
            self.anime.download()


class RetryTests(unittest.TestCase):
    def setUp(self):
        self.ns = definitions('aniGamerPlus.py',
                              {'_pipeline_requeue', '_pipeline_run_download', 'wait_pipeline_done'},
                              dict(Config=Mock(), err_print=Mock(), ingress_fifo=Queue(),
                                   settings={'segment_download_mode': False, 'download_resolution': '1080'},
                                   time=Mock(), _pipeline_download_once=Mock(return_value='retry'),
                                   _pipeline_fail=Mock(), _pipeline_success=Mock(),
                                   _is_cancelled=Mock(return_value=False),
                                   _wait_if_paused=Mock(return_value=False),
                                   _clear_cancel_flag=Mock()))

    def test_retry_exhaustion_goes_to_tail_and_resets_state(self):
        other = {'sn': 20}
        self.ns['ingress_fifo'].put(other)
        anime = Mock()
        anime.get_title.return_value = 'Example'
        job = {'sn': 10, 'anime': anime, 'resume': True}
        self.ns['_pipeline_run_download'](job)
        self.assertEqual(self.ns['_pipeline_download_once'].call_count, 4)
        self.assertEqual(anime.renew.call_count, 3)
        self.assertIs(self.ns['ingress_fifo'].get_nowait(), other)
        self.assertIs(self.ns['ingress_fifo'].get_nowait(), job)
        self.assertEqual(job['err_counter'], 0)
        self.assertNotIn('anime', job)
        self.assertTrue(job['resume'])
        self.ns['_pipeline_fail'].assert_not_called()

    def test_explicit_nonretryable_failure_stops(self):
        self.ns['_pipeline_download_once'].return_value = 'fatal'
        job = {'sn': 10}
        self.ns['_pipeline_run_download'](job)
        self.ns['_pipeline_fail'].assert_called_once_with(job)
        self.assertTrue(self.ns['ingress_fifo'].empty())

    def test_resume_skip_does_not_send_download_notifications(self):
        anime = Mock()
        anime._resume_skipped = True
        self.ns['_pipeline_download_once'].return_value = 'done'
        job = {'sn': 10, 'anime': anime}
        self.ns['_pipeline_run_download'](job)
        anime.finish_download.assert_not_called()
        self.ns['_pipeline_success'].assert_called_once_with(job)

    def test_wait_checks_requeued_jobs_before_returning(self):
        active = {10}
        self.ns.update(ingress_fifo=Mock(), download_fifo=Mock(), merge_fifo=Mock(),
                       _download_sn_active=active, _download_sn_active_lock=threading.Lock())
        self.ns['time'].sleep.side_effect = lambda _: active.clear()
        self.ns['wait_pipeline_done']()
        self.assertEqual(self.ns['ingress_fifo'].join.call_count, 2)


class ResumeQueueTests(unittest.TestCase):
    def test_unequal_categories_preserve_all_54_existing_episodes(self):
        ns = definitions('Anime.py', {'Anime'}, {'re': re, 'Config': Mock()})
        ns['Config'].legalize_filename.side_effect = lambda name: name
        anime = ns['Anime'].__new__(ns['Anime'])
        anime._settings = dict(use_mobile_api=False, download_resolution='1080', zerofill=1,
                               plex_naming=False, add_bangumi_name_to_video_filename=True,
                               customized_video_filename_prefix='【動畫瘋】', customized_bangumi_name_suffix='',
                               add_resolution_to_video_filename=True,
                               customized_video_filename_suffix='', video_filename_extension='mp4')
        anime._sn = 25113
        anime._episode = '1'
        anime._bangumi_name = '關於我轉生變成史萊姆這檔事 [中文配音]'
        anime._bangumi_name_orig = anime._bangumi_name
        groups = [('本篇', list(map(str, range(1, 25))) + ['24.5'], 10000),
                  ('特別篇', list(map(str, range(1, 6))), 20000),
                  ('中文配音', list(map(str, range(1, 25))), 25113)]
        html = '<section class="season">'
        expected = set()
        for heading, episodes, first_sn in groups:
            html += '<p><span>%s</span></p><ul>' % heading
            for offset, episode in enumerate(episodes):
                html += '<li><a href="?sn=%s">%s</a></li>' % (first_sn + offset, episode)
                category = '' if heading == '本篇' else ' [%s]' % heading
                expected.add('【動畫瘋】關於我轉生變成史萊姆這檔事%s[%s][1080P].mp4' % (category, episode))
            html += '</ul>'
        anime._src = BeautifulSoup(html + '</section>', 'html.parser')
        for _ in range(2):  # renew 不得因既有列表而改變分類
            anime._Anime__get_episode_list()
            self.assertEqual(len(anime.get_episode_list()), 54)
            actual = {anime.get_monitor_filename_for_sn(sn) for sn in anime.get_episode_list().values()}
            self.assertEqual(actual, expected)
            for sn in range(25118, 25137):
                self.assertEqual(anime._episode_metadata[sn]['category'], '中文配音')
            self.assertEqual(anime._bangumi_name, '關於我轉生變成史萊姆這檔事 [中文配音]')

    def test_existing_batch_never_enqueues_episodes(self):
        anime = Mock()
        anime.get_episode_list.return_value = {'1': 10, '2': 20}
        anime.get_monitor_filename_for_sn.side_effect = lambda sn, res, **kw: '%s[%sP].mp4' % (sn, res)
        submit = Mock()
        ns = definitions('aniGamerPlus.py',
                         {'__cui', 'resume_episode_filenames', 'has_completed_episode'},
                         dict(build_anime=Mock(return_value={'failed': False, 'anime': anime}),
                              settings={'bangumi_dir': 'example'},
                              find_completed_video_filenames=Mock(return_value={'10[720P].mp4', '20[1080P].mp4'}),
                              enqueue_download_only=submit, print=Mock()))
        ns['__cui'](10, '1080', 'resume', 1, '', dashboard_worker=True)
        submit.assert_not_called()
        ns['build_anime'].assert_called_once_with(10, parse_batch={})
        ns['find_completed_video_filenames'].assert_called_once()

    def test_existing_file_bypasses_download_slot_and_cooldown(self):
        config = Mock()
        limiter = Mock()
        ns = definitions('aniGamerPlus.py', {'_pipeline_download_once'},
                         dict(Config=config, thread_limiter=limiter,
                              _skip_completed_resume_job=Mock(return_value=True),
                              _is_cancelled=Mock(return_value=False),
                              _wait_if_paused=Mock(return_value=False),
                              _wait_download_cd_for=Mock(), _call_anime_download=Mock()))
        self.assertEqual(ns['_pipeline_download_once']({'sn': 10, 'anime': Mock()}, False), 'skipped')
        limiter.acquire.assert_not_called()
        ns['_wait_download_cd_for'].assert_not_called()
        ns['_call_anime_download'].assert_not_called()
        config.start_download_cd.assert_not_called()

    def test_locked_resolution_miss_skips_download_cooldown(self):
        from Anime import ResolutionNotFoundError, TaskCancelledError
        config = Mock()
        limiter = Mock()
        anime = Mock()
        anime._resume_skipped = False
        anime._pending_segment_merge = False
        anime.video_size = 0
        call_download = Mock(side_effect=ResolutionNotFoundError('指定清晰度不存在'))
        ns = definitions(
            'aniGamerPlus.py', {'_pipeline_download_once'},
            dict(Config=config, thread_limiter=limiter, err_print=Mock(),
                 settings={'download_cd': 60, 'segment_download_mode': True},
                 ResolutionNotFoundError=ResolutionNotFoundError,
                 TaskCancelledError=TaskCancelledError,
                 NonRetryableDownloadError=Exception,
                 _skip_completed_resume_job=Mock(return_value=False),
                 _is_cancelled=Mock(return_value=False),
                 _wait_if_paused=Mock(return_value=False),
                 _register_active_anime=Mock(), _unregister_active_anime=Mock(),
                 _wait_download_cd_for=Mock(), _call_anime_download=call_download,
                 traceback=Mock()))
        self.assertEqual(ns['_pipeline_download_once']({'sn': 10, 'anime': anime}, False), 'fatal')
        config.start_download_cd.assert_not_called()
        limiter.release.assert_called_once()

    def test_file_created_after_enqueue_is_skipped_before_parse(self):
        config = Mock()
        release = Mock()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'episode.mp4'
            with path.open('wb') as stream:
                stream.truncate(6 * 1024 * 1024)
            ns = definitions('aniGamerPlus.py',
                             {'_skip_completed_resume_job', 'find_completed_video_filenames'},
                             dict(os=os, Config=config, settings={'bangumi_dir': directory},
                                  _release_download_sn=release))
            job = dict(sn=10, type='download_only', resume=True,
                       resume_filenames={'episode.mp4'})
            self.assertTrue(ns['_skip_completed_resume_job'](job))
            release.assert_called_once_with(10)
            config.remove_task_monitor.assert_called_once_with(10)


class ParsedReuseTests(unittest.TestCase):
    def test_only_same_sn_reuses_independent_attributes_and_job_danmu(self):
        ns = definitions('aniGamerPlus.py', {'_copy_parsed_anime'}, {'copy': copy})
        source = SimpleNamespace(get_sn=lambda: 10, _danmu=True, _bangumi_name='original')
        parsed = ns['_copy_parsed_anime'](source, '10', False)
        self.assertIsNot(parsed, source)
        self.assertFalse(parsed._danmu)
        self.assertTrue(source._danmu)
        parsed._bangumi_name = 'renamed'
        self.assertEqual(source._bangumi_name, 'original')
        self.assertIsNone(ns['_copy_parsed_anime'](source, 20, True))

    def test_ingress_parses_only_jobs_without_reusable_result(self):
        for reuse in (True, False):
            with self.subTest(reuse=reuse):
                anime = Mock()
                job = dict(type='download_only', sn=10, danmu=False,
                           anime=anime if reuse else None)
                ingress = Mock()
                ingress.get.side_effect = [job, StopIteration]
                build = Mock(return_value={'failed': False, 'anime': anime})
                download = Mock()
                ns = definitions('aniGamerPlus.py', {'_ingress_worker_main'},
                                 dict(ingress_fifo=ingress, download_fifo=download,
                                      _skip_completed_resume_job=Mock(return_value=False),
                                      Config=Mock(), build_anime=build, settings={'download_resolution': '1080'},
                                      _update_monitor_after_parse=Mock(), err_print=Mock(),
                                      _is_cancelled=Mock(return_value=False),
                                      _wait_if_paused=Mock(return_value=False),
                                      _pipeline_fail=Mock(), traceback=Mock()))
                with self.assertRaises(StopIteration):
                    ns['_ingress_worker_main']()
                self.assertEqual(build.call_count, 0 if reuse else 1)
                self.assertIs(job['anime'], anime)
                download.put.assert_called_once_with(job)
                ingress.task_done.assert_called_once()

    def test_enqueue_reuses_scanned_episode_but_not_other_episode(self):
        for sn in (10, 20):
            with self.subTest(sn=sn):
                submit = Mock()
                source = SimpleNamespace(get_sn=lambda: 10, _danmu=True)
                ns = definitions('aniGamerPlus.py', {'enqueue_download_only', '_copy_parsed_anime'},
                                 dict(copy=copy, _try_claim_download_sn=Mock(return_value=True),
                                      Config=Mock(), err_print=Mock(), _submit_ingress_job=submit, danmu=True,
                                      _clear_cancel_flag=Mock(), is_pipeline_paused=Mock(return_value=False)))
                ns['enqueue_download_only'](sn, parsed_anime=source, want_danmu=False)
                job = submit.call_args[0][0]
                if sn == 10:
                    self.assertIsNotNone(job['anime'])
                    self.assertFalse(job['anime']._danmu)
                else:
                    self.assertIsNone(job['anime'])


class BatchCooldownTests(unittest.TestCase):
    def test_23_episodes_wait_once_but_next_submission_waits_again(self):
        clock = [0.0]
        condition = MagicMock()
        condition.wait.side_effect = lambda timeout: clock.__setitem__(0, clock[0] + timeout)
        ns = definitions('Config.py', {'wait_parse_sn_cd', 'finish_parse_sn_cd'},
                         dict(_parse_sn_cd_gate=threading.Lock(), _parse_sn_cd_cond=condition,
                              _parse_sn_cd_next_allowed=5.0, read_settings=lambda: {'parse_sn_cd': 5},
                              time=SimpleNamespace(monotonic=lambda: clock[0]), __color_print=Mock()))
        batch = {}
        for sn in range(23):
            ns['wait_parse_sn_cd'](sn, batch=batch)
            ns['finish_parse_sn_cd']()
        self.assertEqual(condition.wait.call_count, 1)
        self.assertEqual(clock[0], 5)
        ns['wait_parse_sn_cd'](100, batch={})
        ns['finish_parse_sn_cd']()
        self.assertEqual(condition.wait.call_count, 2)

    def test_manual_modes_pass_one_batch_to_all_jobs(self):
        for mode, ep_range in [('single', []), ('all', []), ('resume', []),
                               ('latest', []), ('largest-sn', []), ('range', ['1', '2']),
                               ('sn-range', ['10', '20']), ('multi', [10, 20])]:
            with self.subTest(mode=mode):
                anime = Mock()
                anime.get_episode_list.return_value = {'1': 10, '2': 20}
                submit = Mock(return_value=True)
                build = Mock(return_value={'failed': False, 'anime': anime})
                ns = definitions('aniGamerPlus.py', {'__cui'},
                                 dict(build_anime=build, enqueue_download_only=submit,
                                      settings={'bangumi_dir': 'unused'}, print=Mock(),
                                      find_completed_video_filenames=Mock(return_value=set()),
                                      has_completed_episode=Mock(return_value=False),
                                      resume_episode_filenames=Mock(return_value=set()),
                                      _print_batch_enqueue_summary=Mock()))
                ns['__cui'](10, '1080', mode, 1, ep_range, dashboard_worker=True)
                self.assertTrue(submit.called)
                batch = submit.call_args_list[0][1]['parse_batch']
                for call in submit.call_args_list:
                    self.assertIs(call[1]['parse_batch'], batch)
                if build.called:
                    self.assertIs(build.call_args[1]['parse_batch'], batch)


if __name__ == '__main__':
    unittest.main()
