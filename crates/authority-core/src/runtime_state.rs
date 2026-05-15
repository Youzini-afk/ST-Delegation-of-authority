use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Condvar, Mutex};
use std::sync::atomic::{AtomicBool, AtomicU64};

use tokio::sync::Semaphore;

use crate::core_types::ControlJobRecord;

pub(crate) struct RuntimeState {
    pub(crate) job_controls: Mutex<HashMap<String, Arc<AtomicBool>>>,
    pub(crate) job_queue: JobQueue,
    pub(crate) started_at_iso: String,
    pub(crate) queued_job_count: AtomicU64,
    pub(crate) queued_request_count: AtomicU64,
    pub(crate) request_count: AtomicU64,
    pub(crate) error_count: AtomicU64,
    pub(crate) current_concurrency: AtomicU64,
    pub(crate) concurrency_semaphore: Semaphore,
    pub(crate) last_error: Mutex<Option<String>>,
}

pub(crate) struct Config {
    pub(crate) token: String,
    pub(crate) version: String,
    pub(crate) build_hash: Option<String>,
    pub(crate) platform: String,
    pub(crate) api_version: String,
    pub(crate) started_at: String,
    pub(crate) runtime: Arc<RuntimeState>,
}

#[derive(Clone)]
pub(crate) struct JobDispatch {
    pub(crate) db_path: String,
    pub(crate) user_handle: String,
    pub(crate) job: ControlJobRecord,
}

pub(crate) struct JobQueueState {
    pub(crate) items: VecDeque<JobDispatch>,
}

pub(crate) struct JobQueue {
    pub(crate) state: Mutex<JobQueueState>,
    pub(crate) available: Condvar,
}
